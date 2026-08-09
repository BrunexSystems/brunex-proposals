const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const base64UrlToBytes = (value) => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

async function decompress(bytes) {
  if (!('DecompressionStream' in window)) throw new Error('This browser is too old to open the secure proposal. Please use a current version of Chrome, Edge, Firefox, or Safari.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decryptProposal(password) {
  const match = window.location.hash.match(/^#proposal=v1\.([^.]+)\.([^.]+)\.([^.]+)$/);
  if (!match) throw new Error('This proposal link is incomplete. Ask Brunex Systems LLC for a new link.');
  const [, saltValue, ivValue, ciphertextValue] = match;
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64UrlToBytes(saltValue), iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(ivValue) }, key, base64UrlToBytes(ciphertextValue));
  } catch {
    throw new Error('That password did not unlock this proposal. Check it and try again.');
  }
  const decoded = new TextDecoder().decode(await decompress(new Uint8Array(plaintext)));
  const payload = JSON.parse(decoded);
  if (payload?.version !== 1 || !payload.config || !payload.content || !payload.scope || !payload.inputs || !payload.proposalMeta) {
    throw new Error('This proposal format is not supported. Ask Brunex Systems LLC for a new link.');
  }
  return payload;
}

function calculate(inputs, config) {
  const build = config.build_tiers[inputs.build_tier] || Object.values(config.build_tiers)[0];
  const additional = inputs.additional_site ? config.build_tiers[inputs.additional_site_tier] : { fee: 0 };
  const care = config.care_plans[inputs.care_plan] || config.care_plans.None;
  const rates = config.rates;
  const additionalList = inputs.additional_site ? number(additional.fee) : 0;
  const additionalSavings = additionalList * number(rates.additional_site_discount);
  const additionalFee = additionalList - additionalSavings;
  const careTotal = number(care.fee) * number(inputs.care_months);
  const productEntry = number(inputs.product_entry_hours) * number(rates.product_entry);
  const development = number(inputs.dev_hours) * number(rates.development);
  const stripeSetup = inputs.build_tier === config.stripe_eligible_tier && inputs.add_stripe_setup ? number(rates.stripe_setup) : 0;
  const buildCombined = number(build.fee) + additionalFee;
  const deposit = buildCombined * number(rates.deposit_percentage);
  const brunexTotal = buildCombined + careTotal + productEntry + development + stripeSetup;
  const hosting = number(inputs.hosting_per_month) * number(inputs.hosting_months);
  const stripe = number(inputs.transactions) * ((number(inputs.average_transaction) * number(rates.stripe_percentage)) + number(rates.stripe_fixed));
  return { build, care, buildFee: number(build.fee), additionalFee, additionalSavings, deposit, launch: buildCombined - deposit, careTotal, productEntry, development, stripeSetup, brunexTotal, hosting, stripe, allIn: brunexTotal + hosting + stripe };
}

const featureList = (features = []) => `<ul class="feature-list">${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>`;
const scopeBlock = (title, value, list = false) => `<div><h4>${title}</h4>${list ? `<ul>${String(value).split(/\r?\n/).filter(Boolean).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p>${escapeHtml(value)}</p>`}</div>`;
const proposalSections = [
  { id: 'proposal-overview', label: 'Overview' },
  { id: 'project-scope', label: 'Scope' },
  { id: 'build-options', label: 'Build' },
  { id: 'additional-site-options', label: 'Additional Site' },
  { id: 'care-plan-options', label: 'Care Plan' },
  { id: 'additional-services', label: 'Services' },
  { id: 'third-party-costs', label: 'Third-Party Costs' },
  { id: 'client-approval', label: 'Approval' },
];

function renderProposal(payload) {
  const { config, content, scope, proposalMeta: meta } = payload;
  const inputs = { ...payload.inputs };
  const proposal = document.querySelector('#proposal');
  let activeSection = proposalSections[0].id;
  let scrollspyFrame = 0;
  document.title = `${meta.project || 'Proposal'} | Brunex Systems LLC`;

  const preferredScrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const centerActiveTab = (behavior = preferredScrollBehavior()) => {
    const track = proposal.querySelector('.scrollspy-track');
    const button = proposal.querySelector(`[data-scrollspy-target="${activeSection}"]`);
    if (!track || !button || typeof track.scrollTo !== 'function') return;
    const left = button.offsetLeft - ((track.clientWidth - button.offsetWidth) / 2);
    track.scrollTo({ left: Math.max(0, left), behavior });
  };
  const showActiveSection = (nextId, center = true) => {
    if (!nextId) return;
    const changed = nextId !== activeSection;
    activeSection = nextId;
    proposal.querySelectorAll('[data-scrollspy-target]').forEach((button) => {
      const active = button.dataset.scrollspyTarget === activeSection;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
    if (center && changed) centerActiveTab();
  };
  const updateScrollspy = () => {
    scrollspyFrame = 0;
    const nav = proposal.querySelector('.scrollspy-nav');
    if (!nav) return;
    const activationLine = nav.getBoundingClientRect().bottom + 24;
    const atPageEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    let nextId = proposalSections[0].id;
    if (atPageEnd) nextId = proposalSections[proposalSections.length - 1].id;
    else proposalSections.forEach(({ id }) => {
      const section = document.getElementById(id);
      if (section && section.getBoundingClientRect().top <= activationLine) nextId = id;
    });
    showActiveSection(nextId);
  };
  const scheduleScrollspy = () => {
    if (!scrollspyFrame) scrollspyFrame = window.requestAnimationFrame(updateScrollspy);
  };

  const render = () => {
    const result = calculate(inputs, config);
    const tiers = Object.entries(config.build_tiers);
    const plans = Object.entries(config.care_plans);
    const careMonths = number(inputs.care_months);
    proposal.innerHTML = `
      <div class="proposal-toolbar no-print">
        <div><strong>Interactive proposal</strong><span>Choose the options that fit your project. The investment updates automatically.</span></div>
        <button class="print-button" type="button" data-action="print">Print / Save PDF</button>
      </div>
      <section class="hero" id="top">
        <div><p class="eyebrow">${escapeHtml(content.hero.eyebrow)}</p><h1>${escapeHtml(content.hero.title)}<br><em>${escapeHtml(content.hero.emphasis)}</em></h1><p class="hero-copy">${escapeHtml(content.hero.description)}</p></div>
        <div class="hero-stat"><span>${escapeHtml(content.fields.selected_package)}</span><strong>${number(result.build.products)}</strong><small>${escapeHtml(content.fields.products_included)}</small></div>
      </section>
      <nav class="scrollspy-nav no-print" aria-label="Proposal sections"><div class="scrollspy-track">
        ${proposalSections.map(({id,label}) => `<button type="button" data-scrollspy-target="${id}" class="${activeSection === id ? 'active' : ''}" ${activeSection === id ? 'aria-current="location"' : ''}>${label}</button>`).join('')}
      </div></nav>
      <div class="workspace">
        <section class="config-panel">
          <div class="section-heading"><span>01</span><div><p>${escapeHtml(content.sections.configure_eyebrow)}</p><h2>${escapeHtml(content.sections.configure_title)}</h2></div></div>
          <section class="proposal-details scrollspy-section" id="proposal-overview"><p class="section-kicker">CLIENT &amp; PROJECT</p><div class="proposal-details-grid">
            ${[['Prepared for',meta.prepared_for],['Company',meta.company],['Client email',meta.email],['Project',meta.project],['Proposal number',meta.proposal_number],['Proposal date',meta.proposal_date],['Valid through',meta.valid_until]].map(([label,value]) => `<div><span class="detail-label">${label}</span><strong class="detail-value">${escapeHtml(value || '—')}</strong></div>`).join('')}
          </div></section>
          <section class="scope-summary scrollspy-section" id="project-scope"><p class="section-kicker">GENERAL SCOPE</p><h3>Project scope</h3><p class="scope-overview">${escapeHtml(scope.overview)}</p><div class="scope-grid">
            ${scopeBlock('Objectives',scope.objectives)}${scopeBlock('General deliverables',scope.deliverables,true)}${scopeBlock('Timeline',scope.timeline)}${scopeBlock('Assumptions',scope.assumptions)}
            <div class="scope-data-boundary"><span>INFORMATION USE</span><h4>Information handling and HIPAA boundary</h4><p>${escapeHtml(scope.data_handling || 'The proposed website and quote-request features are intended for general product information, product selection, preliminary pricing, and sales follow-up. A visitor may assemble a preliminary product basket for the client to review, but the basket is not an online checkout or authorization of sale; the client will complete and authorize the transaction separately by phone or another approved method. These features are not designed or authorized to collect, process, store, or transmit protected health information (PHI), medical records, diagnoses, prescriptions, insurance information, or other regulated patient information. Any work involving PHI requires prior written approval, a separately defined scope, appropriate compliant service providers, revised pricing, and, when legally required, a fully executed Business Associate Agreement before Brunex Systems LLC receives or handles PHI.')}</p></div>
            ${scopeBlock('Exclusions',scope.exclusions)}
          </div></section>
          <section class="proposal-guide"><p class="section-kicker">HOW TO REVIEW YOUR OPTIONS</p><h3>${escapeHtml(content.guidance.title)}</h3><span>${escapeHtml(content.guidance.description)}</span></section>
          <fieldset class="scrollspy-section" id="build-options"><legend>${escapeHtml(content.fields.build_tier)}</legend><p class="section-blurb">${escapeHtml(content.guidance.build)}</p><div class="tier-grid">
            ${tiers.map(([name,tier]) => `<label class="tier-card ${inputs.build_tier === name ? 'selected' : ''}"><input type="radio" name="build_tier" value="${escapeHtml(name)}" ${inputs.build_tier === name ? 'checked' : ''}><div class="card-topline"><span>${number(tier.products)} PRODUCTS</span><i class="radio-dot"></i></div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(tier.description)}</small>${featureList(tier.features)}<div class="card-price"><b>${money.format(tier.fee)}</b><span>fixed build fee</span></div><div class="card-details"><span><b>${money.format(tier.fee * config.rates.deposit_percentage)}</b> at signing</span><span><b>${number(tier.products)}</b> products included</span></div></label>`).join('')}
          </div><div class="quote-data-notice" role="note"><strong>Completed website: product inquiries only</strong><span>If included, the completed website’s quote baskets and contact fields will accept product selections, quantities, and general sales questions—not patient names, medical conditions, prescriptions, insurance information, or other protected health information. Sales are reviewed and authorized separately.</span></div></fieldset>
          <fieldset class="additional-site scrollspy-section" id="additional-site-options"><label class="toggle-row"><input type="checkbox" name="additional_site" ${inputs.additional_site ? 'checked' : ''}><span><strong>${escapeHtml(content.fields.additional_site)}</strong><small>Apply a ${Math.round(config.rates.additional_site_discount * 100)}% additional-site build discount to the second build.</small></span></label>
            ${inputs.additional_site ? `<div class="additional-options"><legend>${escapeHtml(content.fields.additional_site_tier)}</legend><div class="tier-grid">${tiers.map(([name,tier]) => { const fee=tier.fee*(1-config.rates.additional_site_discount); return `<label class="tier-card ${inputs.additional_site_tier===name?'selected':''}"><input type="radio" name="additional_site_tier" value="${escapeHtml(name)}" ${inputs.additional_site_tier===name?'checked':''}><div class="card-topline"><span>ADDITIONAL SITE</span><i class="radio-dot"></i></div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(tier.description)}</small>${featureList(tier.features)}<div class="card-price"><b>${money.format(fee)}</b><span>discounted build fee</span></div><div class="card-details"><span><s>${money.format(tier.fee)}</s> list price</span><span><b>Save ${money.format(tier.fee-fee)}</b></span></div></label>`; }).join('')}</div></div>` : ''}
          </fieldset>
          <fieldset class="scrollspy-section" id="care-plan-options"><legend>${escapeHtml(content.fields.care_plan)}</legend><p class="section-blurb">${escapeHtml(content.guidance.care)}</p><div class="care-grid">
            ${plans.map(([name,plan]) => `<label class="care-card ${inputs.care_plan===name?'selected':''}"><input type="radio" name="care_plan" value="${escapeHtml(name)}" ${inputs.care_plan===name?'checked':''}><div class="card-topline"><span>${name==='None'?'OPTIONAL':`${plan.hours} EDIT ${plan.hours===1?'HOUR':'HOURS'}`}</span><i class="radio-dot"></i></div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(plan.description)}</small><div class="care-price"><b>${money.format(plan.fee)}</b><span>/ month</span></div><div class="care-math"><span><b>${number(plan.hours)}</b> edit ${number(plan.hours)===1?'hour':'hours'} / month</span><span><b>${careMonths} × ${money.format(plan.fee)}</b> = ${money.format(plan.fee*careMonths)}</span></div></label>`).join('')}
          </div></fieldset>
          <section class="service-rates scrollspy-section" id="additional-services"><p class="section-kicker">ADDITIONAL SERVICES</p><h3>Hourly rates</h3><div class="service-rate-grid"><div><span>Product entry</span><strong>${money.format(config.rates.product_entry)}<small>/hour</small></strong><p>Catalog and product-data entry beyond the selected package allowance.</p></div><div><span>Design &amp; development</span><strong>${money.format(config.rates.development)}<small>/hour</small></strong><p>Ad-hoc technical, design, and development work outside the approved scope.</p></div></div><p class="service-note">Care-plan edit hours do not apply to bulk product-entry work.</p></section>
          <div class="option-controls no-print">
            ${[['care_months',content.fields.care_months,'months'],['product_entry_hours',content.fields.product_hours,`${money.format(config.rates.product_entry)} / hr`],['dev_hours',content.fields.development_hours,`${money.format(config.rates.development)} / hr`]].map(([name,label,suffix]) => `<label class="number-field"><span>${escapeHtml(label)}</span><div><input type="number" min="0" name="${name}" value="${number(inputs[name])}"><small>${escapeHtml(suffix)}</small></div></label>`).join('')}
          </div>
          ${inputs.build_tier===config.stripe_eligible_tier?`<label class="check-row no-print"><input type="checkbox" name="add_stripe_setup" ${inputs.add_stripe_setup?'checked':''}><span>${escapeHtml(content.fields.stripe_setup)} ${money.format(config.rates.stripe_setup)}</span></label>`:`<p class="included-service-note"><b>Stripe payment-link setup is included</b> in the selected build package. Stripe processing charges remain a separate provider cost and can be estimated below.</p>`}
          <section class="third-party-summary-card scrollspy-section" id="third-party-costs" aria-labelledby="third-party-summary-title">
            <div class="third-party-summary-heading"><div><p class="section-kicker">ESTIMATED THIRD-PARTY SERVICES</p><h3 id="third-party-summary-title">Costs paid directly to outside providers</h3></div><strong>Not invoiced by Brunex</strong></div>
            <p class="third-party-summary-copy">Third-party services are disclosed for budgeting clarity. They are not marked up or invoiced by Brunex Systems LLC unless expressly stated. Actual provider pricing may change.</p>
            <div class="third-party-assumptions no-print">
              <div class="third-party-assumptions-heading"><strong>Adjust estimate assumptions</strong><span>Hosting initially follows the care-plan period, but it can be changed separately. Enter expected card activity to estimate Stripe processing.</span></div>
              <div class="third-party-assumption-grid">
                ${[
                  ['hosting_per_month',content.fields.hosting_monthly,'$/month'],
                  ['hosting_months',content.fields.hosting_months,'months'],
                  ['transactions',content.fields.transactions,'transactions'],
                  ['average_transaction',content.fields.average_transaction,'$ average'],
                ].map(([name,label,suffix]) => `<label class="number-field"><span>${escapeHtml(label)}</span><div><input type="number" min="0" name="${name}" value="${number(inputs[name])}"><small>${escapeHtml(suffix)}</small></div></label>`).join('')}
              </div>
            </div>
            <div class="third-party-summary-row">
              <div><i>RECURRING ESTIMATE</i><strong>${escapeHtml(content.estimate.hosting)}</strong><span>${number(inputs.hosting_months)} months × ${money.format(inputs.hosting_per_month)}/month</span></div>
              <b>${money.format(result.hosting)}</b>
            </div>
            <div class="third-party-summary-row"><div><i>USAGE-BASED ESTIMATE</i><strong>${escapeHtml(content.estimate.stripe_processing)}</strong><span>${result.stripe ? `${number(inputs.transactions)} transactions at ${money.format(inputs.average_transaction)} average; provider fee ${(config.rates.stripe_percentage*100).toFixed(1)}% + $${Number(config.rates.stripe_fixed).toFixed(2)} each` : `Enter transaction count and average amount above; provider fee ${(config.rates.stripe_percentage*100).toFixed(1)}% + $${Number(config.rates.stripe_fixed).toFixed(2)} each`}</span></div><b>${money.format(result.stripe)}</b></div>
          </section>
        </section>
        <aside class="estimate-panel">
          <div class="estimate-panel-inner">
          <div class="estimate-sticky-summary">
            <div class="section-heading light"><span>02</span><div><p>${escapeHtml(content.sections.estimate_eyebrow)}</p><h2>${escapeHtml(content.sections.estimate_title)}</h2></div></div>
            <div class="total-card"><span>${escapeHtml(content.estimate.brunex_fees)}</span><strong>${money.format(result.brunexTotal)}</strong><small>${escapeHtml(content.estimate.brunex_note)}</small></div>
            <div class="all-in"><span>${escapeHtml(content.estimate.all_in)}</span><strong>${money.format(result.allIn)}</strong></div>
          </div>
          <div class="price-list">
            <div class="price-row"><span>${escapeHtml(content.estimate.build_fee)}</span><b>${money.format(result.buildFee)}</b></div>
            ${inputs.additional_site?`<div class="price-row"><span>${escapeHtml(content.estimate.additional_site_build)}</span><b>${money.format(result.additionalFee)}</b></div><div class="price-row savings"><span>${escapeHtml(content.estimate.additional_site_savings)}</span><b>−${money.format(result.additionalSavings)}</b></div>`:''}
            <div class="price-row"><span>${escapeHtml(content.estimate.deposit)}</span><b>${money.format(result.deposit)}</b></div><div class="price-row"><span>${escapeHtml(content.estimate.launch_balance)}</span><b>${money.format(result.launch)}</b></div>
            <div class="price-row"><span>${escapeHtml(inputs.care_plan)} ${escapeHtml(content.estimate.care_plan.toLowerCase())}<small>${careMonths} months × ${money.format(result.care.fee)}/month</small></span><b>${money.format(result.careTotal)}</b></div>
            ${result.productEntry?`<div class="price-row"><span>${escapeHtml(content.estimate.product_entry)}</span><b>${money.format(result.productEntry)}</b></div>`:''}${result.development?`<div class="price-row"><span>${escapeHtml(content.estimate.additional_development)}</span><b>${money.format(result.development)}</b></div>`:''}${result.stripeSetup?`<div class="price-row"><span>${escapeHtml(content.estimate.stripe_setup)}</span><b>${money.format(result.stripeSetup)}</b></div>`:''}
          </div>
          <div class="third-party"><p>${escapeHtml(content.estimate.third_party_heading)}</p><div class="price-row"><span>${escapeHtml(content.estimate.hosting)}<small>${number(inputs.hosting_months)} months × ${money.format(inputs.hosting_per_month)}/month</small></span><b>${money.format(result.hosting)}</b></div><div class="price-row"><span>${escapeHtml(content.estimate.stripe_processing)}</span><b>${money.format(result.stripe)}</b></div></div>
          <p class="fine-print">Stripe estimate uses ${(config.rates.stripe_percentage*100).toFixed(1)}% + ${Number(config.rates.stripe_fixed).toFixed(2)} per transaction. ${escapeHtml(content.notes.stripe)}</p>
          </div>
        </aside>
      </div>
      <div class="mobile-cost-float no-print" aria-label="Live proposal totals">
        <div><span>Brunex fees</span><strong>${money.format(result.brunexTotal)}</strong></div>
        <div><span>Third-party estimate</span><strong>${money.format(result.hosting + result.stripe)}</strong></div>
        <div class="mobile-cost-total"><span>Estimated total</span><strong>${money.format(result.allIn)}</strong></div>
      </div>
      <section class="acceptance scrollspy-section" id="client-approval"><p class="section-kicker">CLIENT ACCEPTANCE</p><h2>Approval to proceed</h2><p class="acceptance-copy">By signing below, the client accepts the selected scope and investment shown in this proposal and authorizes Brunex Systems LLC to begin work. The client also acknowledges the information-handling boundary above: protected health information is not authorized under this proposal, and any work involving it requires a separate written scope and, when legally required, a fully executed Business Associate Agreement. Any material change to scope, timing, or third-party costs will be documented separately for approval.</p><div class="signature-grid"><label class="signature-field"><label>Authorized client name</label><input name="client_signer" value="${escapeHtml(meta.client_signer||'')}"></label><label class="signature-field"><label>Title</label><input name="client_title" value="${escapeHtml(meta.client_title||'')}"></label><div class="signature-line"><i></i><span>Authorized signature</span></div><label class="signature-field"><label>Date</label><input type="date" name="client_signed_date" value="${escapeHtml(meta.client_signed_date||'')}"></label></div><p class="acceptance-note">This proposal is valid through ${escapeHtml(meta.valid_until||'the date shown above')}.</p></section>`;
    window.requestAnimationFrame(() => {
      centerActiveTab('auto');
      scheduleScrollspy();
    });
  };

  proposal.addEventListener('change', (event) => {
    const { name, type, checked, value } = event.target;
    if (!name) return;
    if (name.startsWith('client_')) payload.proposalMeta[name] = value;
    else {
      const previousCareMonths = number(inputs.care_months);
      const previousHostingMonths = number(inputs.hosting_months);
      const nextValue = type === 'checkbox' ? checked : type === 'number' ? Math.max(0, number(value)) : value;
      inputs[name] = nextValue;
      if (name === 'care_months' && previousHostingMonths === previousCareMonths) inputs.hosting_months = nextValue;
    }
    render();
  });
  proposal.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="print"]')) window.print();
    const tab = event.target.closest('[data-scrollspy-target]');
    if (!tab) return;
    const targetId = tab.dataset.scrollspyTarget;
    const section = document.getElementById(targetId);
    if (!section) return;
    showActiveSection(targetId);
    section.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
  });
  window.addEventListener('scroll', scheduleScrollspy, { passive: true });
  window.addEventListener('resize', scheduleScrollspy);
  render();
  scheduleScrollspy();
}

const unlockForm = document.querySelector('#unlock-form');
const passwordInput = document.querySelector('#proposal-password');
const errorOutput = document.querySelector('#unlock-error');
document.querySelector('#toggle-password').addEventListener('click', (event) => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  event.currentTarget.textContent = showing ? 'Show' : 'Hide';
  event.currentTarget.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});
unlockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorOutput.textContent = '';
  const button = unlockForm.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = 'Opening…';
  try {
    const payload = await decryptProposal(passwordInput.value);
    document.querySelector('#unlock').hidden = true;
    document.querySelector('#proposal').hidden = false;
    passwordInput.value = '';
    renderProposal(payload);
  } catch (error) {
    errorOutput.textContent = error.message || 'The proposal could not be opened.';
    passwordInput.select();
  } finally {
    button.disabled = false;
    button.textContent = 'Open proposal';
  }
});

if (!window.location.hash.startsWith('#proposal=')) {
  errorOutput.textContent = 'This proposal link is incomplete. Ask Brunex Systems LLC for a new link.';
}
