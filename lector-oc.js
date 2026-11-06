/* Lector de órdenes de compra: saca el texto de un PDF, Excel o CSV y busca los datos del envío.
 * No usa IA: busca palabras clave, nombres de puertos y números con unidades. Todo corre en el navegador.
 * El cliente siempre revisa y corrige lo que se leyó antes de confirmar.
 */
(() => {
  "use strict";
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const SHEETJS = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const cargarScript = (src) => new Promise((ok, mal) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => mal(new Error("No se pudo cargar el lector de archivos"));
    document.head.appendChild(s);
  });

  // ---------- Texto del archivo ----------
  async function textoPDF(file) {
    await cargarScript(PDFJS + "pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let txt = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      txt += c.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n";
    }
    return txt;
  }
  async function textoExcel(file) {
    await cargarScript(SHEETJS);
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map((n) => window.XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: "  " })).join("\n");
  }
  async function texto(file) {
    const n = file.name.toLowerCase();
    if (file.type === "application/pdf" || n.endsWith(".pdf")) return textoPDF(file);
    if (/\.(xlsx|xls)$/.test(n)) return textoExcel(file);
    if (/\.(csv|txt)$/.test(n)) return file.text();
    return null; // imagen u otro: se completa a mano
  }

  // ---------- Números: "1.500", "1,500.00", "1.500,50", "45000" ----------
  function numero(s) {
    s = String(s).replace(/\s/g, "");
    const p = s.lastIndexOf("."), c = s.lastIndexOf(",");
    if (p >= 0 && c >= 0) s = p > c ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
    else if (c >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
    else if (p >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  }
  const NUM = "(\\d[\\d.,]*\\d|\\d)";

  // ---------- Búsqueda de datos ----------
  function buscarPuertos(t, puertos) {
    const hallados = [];
    puertos.forEach((p) => {
      [norm(p.nombre), ...(p.alias || [])].forEach((a) => {
        const re = new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "g");
        let m;
        while ((m = re.exec(t))) hallados.push({ id: p.id, i: m.index, largo: a.length });
      });
    });
    // Si un nombre está dentro de otro más largo en la misma posición (ej. "palmira" en "nueva palmira"), queda el largo
    hallados.sort((a, b) => a.i - b.i || b.largo - a.largo);
    const ctx = (h) => t.slice(Math.max(0, h.i - 60), h.i);
    const ORIG = /(origen|puerto de carga|carga en|cargar en|lugar de carga|loading|pol\b|desde|embarque)[^\n]*$/;
    const DEST = /(destino|puerto de descarga|descarga en|descargar en|lugar de descarga|discharge|pod\b|hasta|entrega)[^\n]*$/;
    let origen = hallados.find((h) => ORIG.test(ctx(h)))?.id || null;
    let destino = hallados.find((h) => DEST.test(ctx(h)) && h.id !== origen)?.id || null;
    const distintos = [...new Set(hallados.map((h) => h.id))];
    if (!origen) origen = distintos.find((id) => id !== destino) || null;
    if (!destino) destino = distintos.find((id) => id !== origen) || null;
    return { origen, destino };
  }

  function buscarCantidad(t) {
    const pruebas = [
      ["teu", new RegExp(`${NUM}\\s*(teus?|contenedores de 20)\\b`)],
      ["t", new RegExp(`${NUM}\\s*(toneladas metricas|toneladas|tonelada|tons?|tn|tm|mt)\\b`)],
      ["m3", new RegExp(`${NUM}\\s*(m3|m³|metros cubicos)`)],
      ["kg", new RegExp(`${NUM}\\s*(kilogramos|kgs?)\\b`)],
      ["t", new RegExp(`(?:cantidad|peso|toneladas)[^\\d\\n]{0,20}${NUM}`)],
    ];
    for (const [unidad, re] of pruebas) {
      const m = t.match(re);
      const v = m && numero(m[1]);
      if (v) return { cantidad: v, unidad };
    }
    return {};
  }

  function buscarFlete(t) {
    const montos = [];
    const res = [new RegExp(`(?:usd|u\\$s|us\\$|u\\$d|\\$)\\s*${NUM}`, "g"), new RegExp(`${NUM}\\s*(?:usd|dolares)`, "g")];
    res.forEach((re) => { let m; while ((m = re.exec(t))) { const v = numero(m[1]); if (v) montos.push({ v, i: m.index }); } });
    if (!montos.length) return null;
    const linea = (i) => t.slice(t.lastIndexOf("\n", i) + 1, i);
    const total = montos.filter((m) => /total|flete|importe|monto/.test(linea(m.i)));
    const lista = total.length ? total : montos;
    return Math.max(...lista.map((m) => m.v));
  }

  function buscarOC(raw) {
    const m = raw.match(/(?:orden\s+de\s+compra|purchase\s+order|o\/c|\boc\b|\bpo\b)\s*(?:n[°ºo]?\.?|nro\.?|n[uú]mero|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
    return m && /\d/.test(m[1]) ? m[1] : null;
  }
  function buscarEmpresa(raw) {
    const m = raw.match(/(?:raz[oó]n\s+social|cliente|comprador|empresa)\s*:\s*([^\n]{3,80})/i);
    return m ? m[1].replace(/\s{2,}.*/, "").trim() : null;
  }

  const PRODUCTOS = [
    ["solido", ["mineral de hierro", "hierro", "manganeso", "soja", "maiz", "trigo", "sorgo", "arroz", "girasol", "harina", "pellets", "clinker", "cemento", "fertilizante", "urea", "azucar", "granos"]],
    ["liquido", ["aceite", "gasoil", "diesel", "combustible", "nafta", "gasolina", "biodiesel", "etanol", "glp"]],
    ["contenedor", ["contenedor", "container"]],
  ];
  function buscarProducto(t) {
    let mejor = null;
    PRODUCTOS.forEach(([tipo, palabras]) => palabras.forEach((w) => {
      const i = t.search(new RegExp(`(^|[^a-z])${w}`));
      if (i >= 0 && (!mejor || i < mejor.i)) mejor = { i, tipo, w };
    }));
    return mejor ? { carga: mejor.w.charAt(0).toUpperCase() + mejor.w.slice(1), tipo_carga: mejor.tipo } : {};
  }

  function extraer(raw, puertos) {
    const t = norm(raw);
    const d = { oc_numero: buscarOC(raw), empresa: buscarEmpresa(raw), ...buscarPuertos(t, puertos), ...buscarProducto(t), ...buscarCantidad(t), flete: buscarFlete(t) };
    if (d.unidad === "teu") d.tipo_carga = "contenedor";
    Object.keys(d).forEach((k) => (d[k] == null || d[k] === "") && delete d[k]);
    return d;
  }

  async function leer(file, puertos) {
    const raw = await texto(file);
    if (raw == null) return { legible: false, datos: {} };
    return { legible: raw.trim().length > 20, datos: extraer(raw, puertos) };
  }

  window.LectorOC = { leer, extraer, numero };
})();
