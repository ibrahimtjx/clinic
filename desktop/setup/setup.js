// First launch (SPEC 2 Rules): ask for the server, trust the clinic CA, remember both.
const { invoke } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);

const MESSAGES = {
  server_required: 'أدخل عنوان الخادم · Enter the server address',
  server_invalid: 'العنوان غير صحيح · The address is not valid',
  server_unreachable: 'تعذر الوصول إلى الخادم · Cannot reach the server',
  ca_not_found: 'لم يتم العثور على شهادة العيادة على الخادم · The clinic certificate was not found on the server',
  ca_invalid: 'الشهادة غير صالحة · The certificate is not valid',
  ca_not_trusted: 'لم تتم إضافة الشهادة · The certificate was not added',
  unsupported_platform: 'هذا الإجراء متاح على Windows فقط · Available on Windows only',
};

let server = '';
let pem = '';

function status(text, error = false) {
  $('status').textContent = text;
  $('status').className = error ? 'error' : '';
}

function busy(on) {
  for (const b of document.querySelectorAll('button')) b.disabled = on;
}

async function connect() {
  busy(true);
  status('جارٍ الاتصال… · Connecting…');
  try {
    server = $('server').value;
    if (await invoke('check_server', { server })) {
      await invoke('set_server', { server }); // already trusted: open the app
      return;
    }
    const ca = await invoke('fetch_ca', { server });
    pem = ca.pem;
    $('fingerprint').textContent = ca.fingerprint;
    $('step-server').hidden = true;
    $('step-ca').hidden = false;
    status('');
  } catch (e) {
    status(MESSAGES[e] ?? String(e), true);
  } finally {
    busy(false);
  }
}

async function trust() {
  busy(true);
  status('بانتظار تأكيد Windows… · Waiting for Windows to confirm…');
  try {
    await invoke('trust_ca', { pem });
    if (!(await invoke('check_server', { server }))) throw 'server_unreachable';
    await invoke('set_server', { server });
  } catch (e) {
    status(MESSAGES[e] ?? String(e), true);
    busy(false);
  }
}

$('connect').addEventListener('click', connect);
$('server').addEventListener('keydown', (e) => e.key === 'Enter' && connect());
$('trust').addEventListener('click', trust);
$('back').addEventListener('click', () => {
  $('step-ca').hidden = true;
  $('step-server').hidden = false;
  status('');
});
invoke('get_config').then((c) => {
  if (c.server) $('server').value = c.server.replace('https://', '');
});
