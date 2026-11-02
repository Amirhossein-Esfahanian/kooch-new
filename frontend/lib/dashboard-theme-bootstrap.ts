export const dashboardThemeStorageKey = "kooch_dashboard_mode";

const dashboardPath = "^/(admin|owner)(/|$)";
const dashboardLoginPath = "^/(admin|owner)/login(/|$)";

export function isDashboardPath(pathname: string) {
  return new RegExp(dashboardPath).test(pathname) && !new RegExp(dashboardLoginPath).test(pathname);
}

// Static, parser-blocking head script: only paints the dashboard canvas/loading
// surface. React still owns the shell's .dark class and the persistent store.
export const dashboardThemeBootstrap = `(function(){if(!new RegExp(${JSON.stringify(dashboardPath)}).test(location.pathname)||new RegExp(${JSON.stringify(dashboardLoginPath)}).test(location.pathname))return;var mode='light';try{if(localStorage.getItem(${JSON.stringify(dashboardThemeStorageKey)})==='dark')mode='dark'}catch(e){}document.documentElement.setAttribute('data-dashboard-mode',mode)})();`;
