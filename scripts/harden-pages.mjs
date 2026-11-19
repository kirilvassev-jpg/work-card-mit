// Apply reviewed output encoding to both generated variants without editing the baseline.
const renderers = new Set(['renderRequests','buildFullInfo','renderTasks','renderServiceRequests','renderTimeline','renderCards','exportCardPDF']);
const fields = 'client_name|client_phone|client_email|client_type|client|company_name|bulstat|contact_person|vehicle|reg_number|description|brand|model|year_of_manufacture|frame_number|km_hours|created_by|responsible_mechanic|status|performed_by|action|details|work_hours|km_traveled|request_number';
export function hardenPage(source, prefix) {
  let html = source;
  const definitions = [...html.matchAll(/^(?:async )?function (\w+)\(/gm)];
  for (let i = definitions.length - 1; i >= 0; i--) {
    const definition = definitions[i];
    if (!renderers.has(definition[1])) continue;
    const start = definition.index, end = definitions[i+1]?.index ?? html.lastIndexOf('</script>');
    let body = html.slice(start,end);
    // UUIDs are also used inside inline handlers, where HTML escaping alone is insufficient.
    body = body.replace(/\$\{((?:r|t|c)\.(?:id|request_id|work_card_id))\}/g, '${WC_SAFE.id($1)}');
    body = body.replace(/(\+\s*)((?:r|t|c)\.(?:id|request_id|work_card_id))(\s*\+)/g, '$1WC_SAFE.id($2)$3');
    body = body.replace(new RegExp('\\$\\{((?:r|t|c|log)\\.(?:'+fields+'))\\}', 'g'), '${WC_SAFE.text($1)}');
    body = body.replace(new RegExp('(\\+\\s*)((?:r|t|c|log)\\.(?:'+fields+'))(\\s*\\+)','g'), '$1WC_SAFE.text($2)$3');
    body = body.replace(new RegExp('\\(((?:r|t|c|log)\\.(?:'+fields+')) \\|\\| (\'[^\']*\')\\)','g'), '(WC_SAFE.text($1) || $2)');
    body = body.replace(/\$\{([rt]\.client_phone \|\| '—')\}/g, '${WC_SAFE.text($1)}');
    body = body.replace(/\+ r\.client_email :/g, '+ WC_SAFE.text(r.client_email) :');
    body = body.replace(/\$\{(a|m)\}/g, '${WC_SAFE.text($1)}');
    body = body.replace(/\+ (a|m) \+/g, '+ WC_SAFE.text($1) +');
    body = body.replace(/r\.notes\.replace\(/g, 'WC_SAFE.text(r.notes).replace(');
    body = body.replace(/\+ \(r\.activity_type \|\| \[\]\)\.join\(', '\) \+/g, "+ WC_SAFE.text((r.activity_type || []).join(', ')) +");
    body = body.replace(/\+ r\.photo_data \+/g, '+ WC_SAFE.text(WC_SAFE.image(r.photo_data)) +');
    body = body.replace(/\|\| log\.action\)/g, '|| WC_SAFE.text(log.action))');
    body = body.replace(/\$\{v\}/g, '${WC_SAFE.text(v)}');
    body = body.replace(/\$\{mechanics\}/g, '${WC_SAFE.text(mechanics)}');
    body = body.replace(/\$\{Array\.isArray\(c\.mechanic\) \? c\.mechanic\.join\(', '\) : c\.mechanic\}/g, "${WC_SAFE.text(Array.isArray(c.mechanic) ? c.mechanic.join(', ') : c.mechanic)}");
    html = html.slice(0,start) + body + html.slice(end);
  }
  html = html.replace(/sessionStorage\.clear\(\); localStorage\.clear\(\); if \(window\.caches\) \{[^\n]*?\} window\.location\.href = 'login\.html';/g, 'WC_SAFE.logout();');
  html = html.replace(/localStorage\.clear\(\)/g, 'WC_SAFE.clearCredentials()');
  html = html.replace("'\" onclick=\"openMachine(\\'' + escH(m.key) + '\\')\">'", "'\" data-machine-key=\"' + WC_SAFE.text(m.key) + '\" onclick=\"openMachine(this.dataset.machineKey)\">'");
  return html.replace('</head>', '<script src="'+prefix+'shared/safe-render.js"></script>\n</head>');
}
