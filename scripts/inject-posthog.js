const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const excludedFiles = new Set([
  'admin/blog-generator.html',
  'admin/index.html',
  'login.html',
  'pages/blog/blog-post-template.html',
  'phonewatch-panel-mockup.html',
  'yandex_661668d20012fbbf.html',
]);
const marker = "posthog.init('phc_Da42RaejuPDp7aaSe8ay5ek3Pz3Aqur4etrHaxYKzgQf'";
const snippet = `<script>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="Ji Yi init fn mn Hr pn bn cn capture calculateEventProperties Sn register register_once register_for_session unregister unregister_for_session Tn getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync Mn identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty Cn xn createPersonProfile setInternalOrTestUser In hn Pn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing debug Ur wt getPageViewId captureTraceFeedback captureTraceMetric an".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('phc_Da42RaejuPDp7aaSe8ay5ek3Pz3Aqur4etrHaxYKzgQf', {
        api_host: 'https://us.i.posthog.com',
        defaults: '2026-05-30',
        person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
    })
</script>`;

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : htmlFiles(path.join(directory, entry.name));
    }
    return entry.isFile() && entry.name.endsWith('.html') ? [path.join(directory, entry.name)] : [];
  });
}

function withoutPostHog(html) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return html;
  const start = html.lastIndexOf('<script>', markerIndex);
  const end = html.indexOf('</script>', markerIndex);
  if (start === -1 || end === -1) throw new Error('Malformed PostHog snippet');
  return html.slice(0, start) + html.slice(end + '</script>'.length).replace(/^\r?\n/, '');
}

function withoutLegacyAnalytics(html) {
  return html
    .replace(/<script\b[^>]*data-goatcounter=["'][^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\sdata-goatcounter-click(?:=["'][^"']*["'])?/gi, '');
}

for (const file of htmlFiles(root)) {
  let html = fs.readFileSync(file, 'utf8');
  html = withoutLegacyAnalytics(html);
  const relativeFile = path.relative(root, file).replace(/\\/g, '/');
  const excluded = excludedFiles.has(relativeFile) || relativeFile.includes('/assets-raw/');

  if (excluded) {
    const cleaned = withoutPostHog(html);
    if (cleaned !== fs.readFileSync(file, 'utf8')) fs.writeFileSync(file, cleaned);
    continue;
  }

  if (!/<head(?:\s[^>]*)?>/i.test(html)) continue;

  if (!html.includes(marker)) {
    if (!/<\/head>/i.test(html)) throw new Error(`Unclosed <head>: ${path.relative(root, file)}`);
    html = html.replace(/<\/head>/i, `${snippet}\n</head>`);
  }

  fs.writeFileSync(file, html);
}
