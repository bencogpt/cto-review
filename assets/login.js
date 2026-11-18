// Login page only: keep a shared link's #anchor (e.g. /2026-11-17/#item-...) through the login redirect.
// The fragment never reaches the server, so append it to the hidden "next" field. Strict pattern; no other effect.
(function(){
  var h=location.hash,f=document.querySelector('.login-form input[name="next"]');
  if(!f||!/^#[A-Za-z0-9_-]{1,100}$/.test(h)||f.value.indexOf("#")>=0)return;
  f.value=f.value+h;
})();
