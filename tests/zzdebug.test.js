const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:5500';
test('debug foto', async ({ page }) => {
  page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(`${BASE}/tests/fixtures/sidebar-harness.html`);
  await page.addScriptTag({ content: `
    window.supabase = { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({data:null}), order: () => ({limit: async () => ({data:[]})}) }) }) , update: () => ({ eq: async () => ({error:null}) }) }),
      rpc: async (n,a) => { console.log('RPC', n, JSON.stringify(a)); return {data:null,error:null}; },
      storage: { from: () => ({ upload: async (...a) => { console.log('UPLOAD', a[0]); return {error:null}; }, getPublicUrl: () => ({data:{publicUrl:'https://x/storage/v1/object/public/avatares/u1/foto.jpg'}}), createSignedUrl: async () => ({data:{signedUrl:''}}), remove: async () => ({}) }) },
    }) };
  `});
  await page.addScriptTag({ url: '/js/config.js' });
  await page.addScriptTag({ url: '/js/layout.js' });
  await page.addScriptTag({ url: '/js/fotos-privadas.js' });
  await page.addScriptTag({ url: '/js/perfil.js' });
  await page.evaluate(() => {
    window.db = supabase.createClient();
    appState.usuario = { id: 'u1', nome_completo: 'X', email:'x@x.com', perfil:'super_admin', foto_url: null };
    document.body.insertAdjacentHTML('beforeend', gerarLayout('D','dashboard'));
  });
  await page.locator('.sidebar-user').click();
  const result = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width=800;c.height=800;
    c.getContext('2d').fillRect(0,0,800,800);
    const blob = await new Promise(r => c.toBlob(r,'image/png'));
    const file = new File([blob],'foto.png',{type:'image/png'});
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('pf-file').files = dt.files;
    try {
      await perfilFotoEscolhida(document.getElementById('pf-file'));
      return 'done';
    } catch(e) { return 'ERR:' + e.message; }
  });
  console.log('RESULT', result);
  await page.waitForTimeout(500);
});
