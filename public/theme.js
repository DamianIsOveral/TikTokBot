(() => {
  const key = 'fay-theme';
  const valid = value => ['system', 'light', 'dark'].includes(value);
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) preference = saved;
  } catch {}

  function apply() {
    root.dataset.theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.querySelectorAll('[data-theme-mode]').forEach(select => { select.value = preference; });
  }

  apply();
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : 'system';
    apply();
  });

  function mount() {
    document.querySelectorAll('[data-theme-mode]').forEach(select => {
      select.addEventListener('change', () => {
        if (!valid(select.value)) return;
        preference = select.value;
        apply();
        const status = document.querySelector('#theme-status');
        try {
          localStorage.setItem(key, preference);
          if (status) status.hidden = true;
        } catch {
          if (status) {
            status.textContent = 'Het thema is aangepast; bewaren voor je volgende bezoek is niet gelukt.';
            status.hidden = false;
          }
        }
      });
    });
    apply();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
