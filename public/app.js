// ──────────────── PRODUCT CATALOG ────────────────
const INITIAL_PRODUCTS = [
  {
    id: 'pixel-9-pro',
    name: 'Google Pixel 9 Pro (128GB)',
    category: 'Electronics',
    price: 999.00,
    qty: 1,
    image: 'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=160&h=160&fit=crop&q=80'
  },
  {
    id: 'tech-fleece-hoodie',
    name: 'Google Tech Fleece Hoodie (Charcoal)',
    category: 'Clothing',
    price: 85.00,
    qty: 1,
    image: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=160&h=160&fit=crop&q=80'
  },
  {
    id: 'cloud-running-shoes',
    name: 'Google Cloud Sprint Running Shoes',
    category: 'Footwear',
    price: 120.00,
    qty: 1,
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=160&h=160&fit=crop&q=80'
  },
  {
    id: 'pixel-buds-pro-2',
    name: 'Pixel Buds Pro 2 (Hazel)',
    category: 'Electronics',
    price: 229.00,
    qty: 1,
    image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=160&h=160&fit=crop&q=80'
  }
];

let cartItems = [];
let isEmployeeVerified = false;
let verifiedClaims = null;
let verificationError = null;

// ──────────────── TERM PLAN STATE ────────────────
let isTermPlanVerified = false;
let termPlanClaims = null;
let termPlanQuote = null;
let termPlanError = null;

// ──────────────── INITIALIZATION ────────────────
document.addEventListener('DOMContentLoaded', async () => {
  sessionStorage.removeItem('acme_verified_claims');
  loadCartState();
  initTabs();
  await checkUrlParamsForVerification();
  renderCart();
  renderTermPlan();
  setupEventListeners();
});

// ──────────────── CART STATE & STORAGE ────────────────
function loadCartState() {
  const saved = sessionStorage.getItem('acme_cart_items');
  if (saved) {
    try {
      cartItems = JSON.parse(saved);
    } catch (e) {
      cartItems = [...INITIAL_PRODUCTS];
    }
  } else {
    cartItems = [...INITIAL_PRODUCTS];
  }
}

function saveCartState() {
  sessionStorage.setItem('acme_cart_items', JSON.stringify(cartItems));
}

// ──────────────── TAB SWITCHING ────────────────
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabName) {
  if (!tabName || tabName === 'cart_discount') tabName = 'cart';
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });
}

// ──────────────── URL PARAMETER HANDLER (OID4VP RETURN) ────────────────
async function checkUrlParamsForVerification() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const verified = params.get('verified');
  const errorMsg = params.get('error');
  let activeTab = params.get('tab') || 'cart';
  if (activeTab === 'cart_discount') activeTab = 'cart';

  switchTab(activeTab);

  if (sessionId) {
    if (verified === 'false' || errorMsg) {
      if (activeTab === 'term_plan') {
        isTermPlanVerified = false;
        termPlanClaims = null;
        termPlanQuote = null;
        termPlanError = errorMsg || 'Presentation cryptographically rejected';
      } else {
        isEmployeeVerified = false;
        verifiedClaims = null;
        verificationError = errorMsg || 'Presentation cryptographically rejected';
      }
    } else if (verified === 'true') {
      try {
        const res = await fetch(`/api/oid4vp/status/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'verified') {
            if (activeTab === 'term_plan' || data.useCase === 'term_plan') {
              isTermPlanVerified = true;
              termPlanClaims = data.claims;
              termPlanQuote = data.claims?.termPlanQuote || null;
              termPlanError = null;
              activeTab = 'term_plan';
            } else {
              isEmployeeVerified = true;
              verifiedClaims = data.claims;
              verificationError = null;
              activeTab = 'cart';
            }
          } else if (data.status === 'failed') {
            if (activeTab === 'term_plan' || data.useCase === 'term_plan') {
              isTermPlanVerified = false;
              termPlanClaims = null;
              termPlanQuote = null;
              termPlanError = data.error || 'Verification failed';
              activeTab = 'term_plan';
            } else {
              isEmployeeVerified = false;
              verifiedClaims = null;
              verificationError = data.error || 'Verification failed';
              activeTab = 'cart';
            }
          }
        }
      } catch (err) {
        console.warn('Failed to fetch session claims:', err);
      }
    }

    // Clean up URL without reload
    window.history.replaceState({}, '', window.location.pathname);
  }

  switchTab(activeTab);
  renderCart();
  renderTermPlan();
}

// ──────────────── RENDER CART & TOTALS ────────────────
function renderCart() {
  const container = document.getElementById('cart-items-container');
  if (!container) return;

  container.innerHTML = '';
  let subtotal = 0;
  let totalItems = 0;

  cartItems.forEach((item, index) => {
    const itemTotal = item.price * item.qty;
    subtotal += itemTotal;
    totalItems += item.qty;

    const el = document.createElement('div');
    el.className = 'cart-item';
    el.innerHTML = `
      <div class="item-img-wrap">
        <img src="${item.image}" alt="${item.name}" class="item-img">
      </div>
      <div class="item-details">
        <div class="item-category">${item.category}</div>
        <h4>${item.name}</h4>
        <div class="item-unit-price">$${item.price.toFixed(2)} each</div>
      </div>
      <div class="quantity-picker">
        <button class="qty-btn" onclick="updateQty(${index}, -1)">−</button>
        <input type="text" class="qty-input" value="${item.qty}" readonly>
        <button class="qty-btn" onclick="updateQty(${index}, 1)">+</button>
      </div>
      <div class="item-subtotal-col">
        <div class="item-subtotal">$${itemTotal.toFixed(2)}</div>
        <button class="btn-remove" onclick="removeItem(${index})">Remove</button>
      </div>
    `;
    container.appendChild(el);
  });

  document.getElementById('total-items-badge').innerText = totalItems;

  // Pricing calculations
  const tax = subtotal * 0.08;
  const discountRate = isEmployeeVerified ? 0.20 : 0.0;
  const discountAmount = subtotal * discountRate;
  const total = subtotal + tax - discountAmount;

  document.getElementById('summary-subtotal').innerText = `$${subtotal.toFixed(2)}`;
  document.getElementById('summary-tax').innerText = `$${tax.toFixed(2)}`;
  document.getElementById('summary-total').innerText = `$${total.toFixed(2)}`;

  // Discount row UI
  const discountRow = document.getElementById('discount-breakdown-row');
  const discountAmountEl = document.getElementById('summary-discount');
  const badgeBox = document.getElementById('badge-box');
  const unverifiedState = document.getElementById('badge-unverified-state');
  const verifiedState = document.getElementById('badge-verified-state');

  if (isEmployeeVerified && verifiedClaims) {
    discountRow.classList.remove('hidden');
    discountAmountEl.innerText = `-$${discountAmount.toFixed(2)}`;
    badgeBox.classList.add('verified');
    unverifiedState.classList.add('hidden');
    verifiedState.classList.remove('hidden');

    const fullName = [verifiedClaims.given_name, verifiedClaims.family_name].filter(Boolean).join(' ') || verifiedClaims.email || 'Verified Employee';
    const dept = verifiedClaims.department || '';
    const empId = verifiedClaims.employee_id || '';
    const email = verifiedClaims.email || '';

    const metaItems = [];
    if (dept) metaItems.push(`<span id="badge-holder-dept">${escapeHtml(dept)}</span>`);
    if (empId) metaItems.push(`ID: <span id="badge-holder-id">${escapeHtml(empId)}</span>`);
    if (email) metaItems.push(`<span>${escapeHtml(email)}</span>`);

    verifiedState.innerHTML = `
      <div class="verified-badge-card">
        <div class="badge-check-icon">✓</div>
        <div class="badge-info">
          <div class="badge-holder-name" id="badge-holder-name">${escapeHtml(fullName)}</div>
          ${metaItems.length > 0 ? `<div class="badge-holder-meta">${metaItems.join(' • ')}</div>` : ''}
          <div class="badge-sd-pill">🔒 Selective Disclosure: Name & Company ID Only</div>
        </div>
      </div>
      <div class="discount-active-notice">
        🎉 20% Employee discount applied from Verifiable Presentation!
      </div>
    `;
  } else {
    discountRow.classList.add('hidden');
    badgeBox.classList.remove('verified');
    unverifiedState.classList.remove('hidden');
    verifiedState.classList.add('hidden');
    verifiedState.innerHTML = '';
  }

  // Verification Error Notice
  const errorBox = document.getElementById('verification-error-notice');
  if (errorBox) {
    if (verificationError && !isEmployeeVerified) {
      errorBox.classList.remove('hidden');
      errorBox.innerHTML = `
        <div class="verification-error-card">
          <div class="error-badge-icon">⚠️</div>
          <div class="error-badge-info">
            <div class="error-badge-title">Presentation Cryptographically Rejected</div>
            <div class="error-badge-desc">${escapeHtml(verificationError)}</div>
          </div>
        </div>
      `;
    } else {
      errorBox.classList.add('hidden');
      errorBox.innerHTML = '';
    }
  }

  saveCartState();
}

function updateQty(index, change) {
  if (cartItems[index]) {
    cartItems[index].qty += change;
    if (cartItems[index].qty <= 0) {
      cartItems.splice(index, 1);
    }
    renderCart();
  }
}

function removeItem(index) {
  cartItems.splice(index, 1);
  renderCart();
}

// ──────────────── RENDER TERM PLAN BUY ────────────────
function renderTermPlan() {
  const quoteCard = document.getElementById('term-quote-card');
  const unverifiedState = document.getElementById('term-unverified-state');
  const verifiedState = document.getElementById('term-verified-state');
  const errorBox = document.getElementById('term-error-notice');

  if (!quoteCard || !unverifiedState || !verifiedState) return;

  if (isTermPlanVerified && termPlanClaims && termPlanQuote) {
    quoteCard.classList.add('verified');
    unverifiedState.classList.add('hidden');
    verifiedState.classList.remove('hidden');

    const fullName = [termPlanClaims.given_name, termPlanClaims.family_name].filter(Boolean).join(' ') || termPlanClaims.email || 'Verified Policyholder';
    const dept = termPlanClaims.department || 'Staff';
    const empId = termPlanClaims.employee_id || 'N/A';
    const fitness = termPlanClaims.fitness_status || 'Fit for Duty';
    const hospital = termPlanQuote.hospitalName || 'Lilavati Hospital & Research Centre';
    const physician = termPlanQuote.physicianName || 'Dr. P. Deshmukh, MD';
    const bloodGroup = termPlanClaims.blood_group || 'O+';
    const isFit = fitness.toLowerCase().includes('fit');

    verifiedState.innerHTML = `
      <div class="term-verified-banner">
        <div class="term-check-circle">✓</div>
        <div class="term-verified-banner-text">
          <div class="term-banner-title">Dual Credentials Cryptographically Verified</div>
          <div class="term-banner-sub">Employee Badge + Medical Certificate</div>
        </div>
      </div>

      <!-- Verified Policyholder Profile -->
      <div class="term-holder-card">
        <div class="holder-avatar">👤</div>
        <div class="holder-meta">
          <div class="holder-name">${escapeHtml(fullName)}</div>
          <div class="holder-sub">${escapeHtml(dept)} • Employee ID: <strong>${escapeHtml(empId)}</strong></div>
        </div>
      </div>

      <!-- Health Underwriting Badge -->
      <div class="term-health-verified-box">
        <div class="health-box-header">
          <span class="health-icon">🏥</span>
          <strong>Lilavati Certified Clinical Status</strong>
        </div>
        <div class="health-meta-grid">
          <div><span class="meta-label">Status:</span> <span class="meta-val ${isFit ? 'status-fit' : 'status-cond'}">${escapeHtml(fitness)}</span></div>
          <div><span class="meta-label">Blood Group:</span> <span class="meta-val">${escapeHtml(bloodGroup)}</span></div>
          <div><span class="meta-label">Physician:</span> <span class="meta-val">${escapeHtml(physician)}</span></div>
          <div><span class="meta-label">Hospital:</span> <span class="meta-val">${escapeHtml(hospital)}</span></div>
        </div>
      </div>

      <!-- Underwritten Quote Card -->
      <div class="term-quote-pricing-box">
        <div class="tier-chip-wrap">
          <span class="tier-chip ${isFit ? 'tier-chip-plat' : 'tier-chip-std'}">${escapeHtml(termPlanQuote.eligibility)}</span>
        </div>
        <div class="coverage-display">
          <div class="coverage-label">Calculated Guaranteed Coverage</div>
          <div class="coverage-amount">${escapeHtml(termPlanQuote.coverageAmount)}</div>
          <div class="coverage-tenure">${escapeHtml(termPlanQuote.termLength)}</div>
        </div>

        <div class="premium-pricing-breakdown">
          <div class="price-row">
            <span>Standard Market Rate</span>
            <span class="struck-price">$${termPlanQuote.basePremium.toFixed(2)}/mo</span>
          </div>
          <div class="price-row subsidy-row">
            <span>Corporate Group Subsidy (${termPlanQuote.corporateSubsidyPct})</span>
            <span class="subsidy-amount">-$${termPlanQuote.discountAmount.toFixed(2)}/mo</span>
          </div>
          <div class="price-divider"></div>
          <div class="price-row final-price-row">
            <span>Your Monthly Cost</span>
            <span class="final-premium">$${termPlanQuote.finalMonthlyPremium.toFixed(2)}<span>/mo</span></span>
          </div>
        </div>

        <div class="waiver-note">
          ✨ <strong>Medical Exam Waiver:</strong> ${escapeHtml(termPlanQuote.medicalExamWaiver)}
        </div>
      </div>

      <!-- Action Button -->
      <button class="btn-buy-term" id="btn-buy-term-policy" onclick="handleBuyTermPolicy()">
        <span>Buy Term Plan ($${termPlanQuote.finalMonthlyPremium.toFixed(2)}/mo)</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
      <div class="term-post-note">Instant binding • Payroll deductible • 30-day money-back guarantee</div>
    `;
  } else {
    quoteCard.classList.remove('verified');
    unverifiedState.classList.remove('hidden');
    verifiedState.classList.add('hidden');
    verifiedState.innerHTML = '';
  }

  // Error Notice
  if (errorBox) {
    if (termPlanError && !isTermPlanVerified) {
      errorBox.classList.remove('hidden');
      errorBox.innerHTML = `
        <div class="verification-error-card">
          <div class="error-badge-icon">⚠️</div>
          <div class="error-badge-info">
            <div class="error-badge-title">Presentation Cryptographically Rejected</div>
            <div class="error-badge-desc">${escapeHtml(termPlanError)}</div>
          </div>
        </div>
      `;
    } else {
      errorBox.classList.add('hidden');
      errorBox.innerHTML = '';
    }
  }
}

// ──────────────── OID4VP VERIFICATION FLOW ────────────────
let qrPollingInterval = null;
let qrCodeInstance = null;

function setupEventListeners() {
  const btnApply = document.getElementById('btn-apply-discount');
  if (btnApply) {
    btnApply.addEventListener('click', () => startVerificationFlow('cart_discount', 'btn-apply-discount'));
  }

  const btnShowQr = document.getElementById('btn-show-qr');
  if (btnShowQr) {
    btnShowQr.addEventListener('click', () => openQrModal('cart_discount'));
  }

  const btnTermApply = document.getElementById('btn-term-apply-wallet');
  if (btnTermApply) {
    btnTermApply.addEventListener('click', () => startVerificationFlow('term_plan', 'btn-term-apply-wallet'));
  }

  const btnTermQr = document.getElementById('btn-term-show-qr');
  if (btnTermQr) {
    btnTermQr.addEventListener('click', () => openQrModal('term_plan'));
  }

  const btnCheckout = document.getElementById('btn-checkout');
  if (btnCheckout) {
    btnCheckout.addEventListener('click', handleCheckout);
  }
}

async function startVerificationFlow(useCase = 'cart_discount', btnId = 'btn-apply-discount') {
  const btn = document.getElementById(btnId);
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>Connecting to Wallet...</span>`;
  }

  try {
    saveCartState();

    const response = await fetch('/api/oid4vp/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        useCase,
        returnOrigin: window.location.origin
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const session = await response.json();
    console.log(`[Verifier] Created OID4VP session for ${useCase}:`, session);

    // Direct redirection to wallet running at http://localhost:3001
    window.location.href = session.walletAuthUrl;
  } catch (err) {
    console.error('[Verifier] Verification error:', err);
    alert('Failed to connect to wallet. Ensure Docker containers are running.');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function openQrModal(useCase = 'cart_discount') {
  const modal = document.getElementById('qr-modal');
  const qrContainer = document.getElementById('qrcode-container');
  const statusText = document.getElementById('qr-status-text');
  const spinner = document.getElementById('qr-loading-spinner');

  if (!modal || !qrContainer) return;

  if (qrPollingInterval) {
    clearInterval(qrPollingInterval);
    qrPollingInterval = null;
  }
  qrContainer.innerHTML = '';
  if (spinner) spinner.classList.remove('hidden');
  if (statusText) statusText.innerText = 'Creating session...';

  modal.classList.remove('hidden');

  try {
    saveCartState();

    const response = await fetch('/api/oid4vp/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        useCase,
        returnOrigin: window.location.origin
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const session = await response.json();
    console.log(`[Verifier] QR session created (${useCase}):`, session);

    const qrUri = `openid4vp://?client_id=x509_san_dns:verifier.localhost&request_uri=${encodeURIComponent(session.requestUri)}`;

    if (spinner) spinner.classList.add('hidden');
    qrContainer.innerHTML = '';

    qrCodeInstance = new QRCode(qrContainer, {
      text: qrUri,
      width: 200,
      height: 200,
      colorDark: '#202124',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });

    if (statusText) {
      statusText.innerText = useCase === 'term_plan'
        ? 'Waiting for Employee + Medical credentials...'
        : 'Waiting for Google Employee Badge...';
    }

    startQrPolling(session.sessionId, useCase);
  } catch (err) {
    console.error('[Verifier] Error creating QR session:', err);
    if (spinner) spinner.classList.add('hidden');
    if (statusText) statusText.innerText = 'Failed to generate QR code.';
  }
}

function closeQrModal() {
  if (qrPollingInterval) {
    clearInterval(qrPollingInterval);
    qrPollingInterval = null;
  }
  const modal = document.getElementById('qr-modal');
  if (modal) modal.classList.add('hidden');
}

function startQrPolling(sessionId, useCase = 'cart_discount') {
  if (qrPollingInterval) clearInterval(qrPollingInterval);

  qrPollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/oid4vp/status/${sessionId}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.status === 'verified') {
        clearInterval(qrPollingInterval);
        qrPollingInterval = null;

        const statusText = document.getElementById('qr-status-text');
        if (statusText) statusText.innerText = '✅ Presentation verified successfully!';

        if (useCase === 'term_plan') {
          isTermPlanVerified = true;
          termPlanClaims = data.claims;
          termPlanQuote = data.claims?.termPlanQuote || null;
          termPlanError = null;
          switchTab('term_plan');
        } else {
          isEmployeeVerified = true;
          verifiedClaims = data.claims;
          verificationError = null;
          switchTab('cart');
        }

        setTimeout(() => {
          closeQrModal();
          if (useCase === 'term_plan') renderTermPlan();
          else renderCart();
        }, 800);
      } else if (data.status === 'failed') {
        clearInterval(qrPollingInterval);
        qrPollingInterval = null;

        const statusText = document.getElementById('qr-status-text');
        if (statusText) {
          statusText.innerHTML = `❌ <strong>Verification Failed:</strong> ${escapeHtml(data.error || 'Cryptographic rejection')}`;
        }

        if (useCase === 'term_plan') {
          isTermPlanVerified = false;
          termPlanClaims = null;
          termPlanQuote = null;
          termPlanError = data.error || 'Cryptographic verification failed';
        } else {
          isEmployeeVerified = false;
          verifiedClaims = null;
          verificationError = data.error || 'Cryptographic verification failed';
        }

        setTimeout(() => {
          closeQrModal();
          if (useCase === 'term_plan') renderTermPlan();
          else renderCart();
        }, 2000);
      }
    } catch (e) {
      console.warn('[Verifier] Polling error:', e);
    }
  }, 1200);
}

// ──────────────── BUY TERM PLAN MODAL ────────────────
function handleBuyTermPolicy() {
  const modal = document.getElementById('term-buy-modal');
  const summaryEl = document.getElementById('term-policy-summary');
  if (!modal || !summaryEl || !termPlanQuote) return;

  const fullName = [termPlanClaims?.given_name, termPlanClaims?.family_name].filter(Boolean).join(' ') || 'Employee';
  const policyNum = 'POL-GP-' + Math.floor(100000 + Math.random() * 900000);

  summaryEl.innerHTML = `
    <div><strong>Policy Number:</strong> <code>${policyNum}</code></div>
    <div><strong>Policyholder:</strong> ${escapeHtml(fullName)}</div>
    <div><strong>Employee ID:</strong> ${escapeHtml(termPlanClaims?.employee_id || 'N/A')}</div>
    <div><strong>Assured Sum (Coverage):</strong> <span style="color:#1a73e8; font-weight:700;">${escapeHtml(termPlanQuote.coverageAmount)}</span></div>
    <div><strong>Plan Tenure:</strong> ${escapeHtml(termPlanQuote.termLength)}</div>
    <div><strong>Underwritten Tier:</strong> ${escapeHtml(termPlanQuote.eligibility)}</div>
    <div><strong>Certified Health Status:</strong> <span style="color:#1e8e3e; font-weight:600;">${escapeHtml(termPlanClaims?.fitness_status || 'Fit')}</span> (${escapeHtml(termPlanQuote.hospitalName)})</div>
    <div><strong>Monthly Premium:</strong> <strong>$${termPlanQuote.finalMonthlyPremium.toFixed(2)}/mo</strong> (Includes ${termPlanQuote.corporateSubsidyPct} Corporate Subsidy)</div>
    <div style="margin-top:10px; font-size:12px; color:#5f6368;">Digital Policy Certificate securely registered to your corporate HR and benefits profile.</div>
  `;

  modal.classList.remove('hidden');
}

function closeTermBuyModal() {
  const modal = document.getElementById('term-buy-modal');
  if (modal) modal.classList.add('hidden');
}

// ──────────────── CHECKOUT MODAL ────────────────
function handleCheckout() {
  const modal = document.getElementById('checkout-modal');
  const receipt = document.getElementById('receipt-summary');

  let subtotal = 0;
  cartItems.forEach(i => subtotal += (i.price * i.qty));
  const tax = subtotal * 0.08;
  const discount = isEmployeeVerified ? subtotal * 0.20 : 0;
  const total = subtotal + tax - discount;

  receipt.innerHTML = `
    <div><strong>Items:</strong> ${cartItems.length} products</div>
    <div><strong>Subtotal:</strong> $${subtotal.toFixed(2)}</div>
    ${isEmployeeVerified ? `<div style="color: #1e8e3e"><strong>20% Employee Discount:</strong> -$${discount.toFixed(2)} (${verifiedClaims?.given_name || 'Staff'})</div>` : ''}
    <div><strong>Tax (8%):</strong> $${tax.toFixed(2)}</div>
    <div style="font-size: 16px; margin-top: 8px;"><strong>Total Paid:</strong> $${total.toFixed(2)}</div>
  `;

  modal.classList.remove('hidden');
}

function closeCheckoutModal() {
  document.getElementById('checkout-modal').classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
