// Office sign-in uses the existing login.html address; mechanic handlers stay unchanged.
window.loginMSAL = function () {
  if (!['admin','manager','coordinator'].includes(selectedRole)) return;
  sessionStorage.setItem('wc_office_login_pending','1');
  sessionStorage.setItem('wc_office_login_auto','1');
  sessionStorage.setItem('wc_office_login_role',selectedRole);
  location.reload();
};
