(function(){
var list=document.getElementById('srcs');if(!list)return;
var rows=Array.prototype.slice.call(list.children),q=document.getElementById('q'),
sels=Array.prototype.slice.call(document.querySelectorAll('.afilters select[data-k]')),
sort=document.getElementById('sort'),cnt=document.getElementById('cnt'),empty=document.getElementById('empty'),
total=rows.length,data=rows.map(function(r){var d=r.dataset;return{el:r,q:d.q,topic:' '+d.topic+' ',rel:d.rel,status:d.status,
type:d.type,lang:d.lang,access:d.access,name:d.name,used:+d.used,added:d.added||''}}),t;
function apply(){
  var terms=q.value.trim().toLowerCase().split(/\s+/).filter(Boolean),f={};
  sels.forEach(function(s){if(s.value)f[s.dataset.k]=s.value});
  var n=0;
  for(var i=0;i<data.length;i++){var d=data[i],ok=true;
    for(var k in f){if(k==='topic'?d.topic.indexOf(' '+f[k]+' ')<0:d[k]!==f[k]){ok=false;break}}
    if(ok)for(var j=0;j<terms.length;j++){if(d.q.indexOf(terms[j])<0){ok=false;break}}
    d.el.hidden=!ok;if(ok)n++}
  cnt.textContent='מוצגים '+n+' מתוך '+total;empty.classList.toggle('hidden',n>0);
  var p=[];if(q.value.trim())p.push('q='+encodeURIComponent(q.value.trim()));
  for(var k2 in f)p.push(k2+'='+encodeURIComponent(f[k2]));
  if(sort.value!=='rel')p.push('sort='+sort.value);
  history.replaceState(null,'',p.length?'#'+p.join('&'):location.pathname);
}
function doSort(){var v=sort.value,c=data.slice();
  c.sort(function(a,b){
    if(v==='name')return a.name.localeCompare(b.name,'he');
    if(v==='used')return b.used-a.used||a.name.localeCompare(b.name);
    if(v==='added')return b.added.localeCompare(a.added)||a.name.localeCompare(b.name);
    return b.rel-a.rel||a.name.localeCompare(b.name)});
  var fr=document.createDocumentFragment();c.forEach(function(d){fr.appendChild(d.el)});list.appendChild(fr);}
q.addEventListener('input',function(){clearTimeout(t);t=setTimeout(apply,80)});
sels.forEach(function(s){s.addEventListener('change',apply)});
sort.addEventListener('change',function(){doSort();apply()});
document.getElementById('reset').addEventListener('click',function(){q.value='';sels.forEach(function(s){s.value=''});sort.value='rel';doSort();apply();q.focus()});
var ex=document.getElementById('expand'),open=false;
ex.addEventListener('click',function(){open=!open;data.forEach(function(d){if(!d.el.hidden)d.el.firstChild.open=open});ex.textContent=open?'סגירת הכל':'פתיחת הכל'});
// restore state from the URL hash (shareable filtered views)
if(location.hash.length>1&&location.hash.indexOf('=')>0){location.hash.slice(1).split('&').forEach(function(kv){
  var a=kv.split('='),k=a[0],v=decodeURIComponent(a[1]||'');
  if(k==='q')q.value=v;else if(k==='sort')sort.value=v;else sels.forEach(function(s){if(s.dataset.k===k)s.value=v})});
  doSort();apply();}
})();
