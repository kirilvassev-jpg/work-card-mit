(async function () {
  var page=location.pathname.split('/').pop() || 'index.html';
  var pages=["login.html","requests.html","assign.html","schedule.html","history.html","dashboard.html","index.html","tablet.html"];
  if (!pages.includes(page)) page='login.html';
  try {
    var role=sessionStorage.getItem('workcard_role');
    var office=page==='login.html' ? sessionStorage.getItem('wc_office_login_pending')==='1' : ['admin','manager','coordinator','office'].includes(role);
    // This only selects a screen. The office API independently verifies identity and role.
    var url=new URL("compat/releases/6715e801d3476b24/"+(office?'office/':'legacy/')+page, location.href);
    var response=await fetch(url.href);
    if (!response.ok) throw Error('Неуспешно зареждане на страницата.');
    var html=await response.text();
    document.open(); document.write(html); document.close();
  } catch (error) {
    document.getElementById('loadStatus').textContent='Страницата не се зареди. Провери връзката и натисни „Опитай отново“.';
    document.getElementById('retry').hidden=false;
  }
})();
