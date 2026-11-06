// Configuración general. Para mudar la app a otro proyecto de Supabase, cambiá estas dos líneas.
// La clave "publishable" es pública por diseño: la seguridad la dan las reglas (RLS) de la base.
window.APP_CONFIG = {
  SUPABASE_URL: "https://buxprkoyckcclbfyrmyb.supabase.co",
  SUPABASE_KEY: "sb_publishable_lB4lk7xvxCE8MJAgMOEnGA_Y-X1hkMn",
  NAVIERA: "InterBarge",
  // MODO_DEMO: true = sin inicio de sesión. Los envíos de la demo se guardan solo en el navegador
  // y la "Parte administrativa" (Coralia, Sylvera, Bolsa) se abre con un clic.
  // Para volver al login real con la base de Supabase, poner false.
  MODO_DEMO: true,
  CONTACTO_CORALIA: "https://coraliae.com",
  DOMINIO_CORALIA: "coraliae.com",
};
