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

// ──────────────── INITIALIZATION ────────────────
document.addEventListener('DOMContentLoaded', async () => {
  sessionStorage.removeItem('acme_verified_claims');
  loadCartState();
  initTabs();
  await checkUrlParamsForVerification();
  renderCart();
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
  let activeTab = params.get('tab') || 'cart';
  if (activeTab === 'cart_discount') activeTab = 'cart';

  switchTab(activeTab);

  if (sessionId && verified === 'true') {
    try {
      const res = await fetch(`/api/oid4vp/status/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'verified') {
          isEmployeeVerified = true;
          verifiedClaims = data.claims;
          activeTab = 'cart';
        }
      }
    } catch (err) {
      console.warn('Failed to fetch session claims:', err);
    }

    // Clean up URL without reload
    window.history.replaceState({}, '', window.location.pathname);
  }

  switchTab(activeTab);
  renderCart();
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

// ──────────────── OID4VP VERIFICATION FLOW ────────────────
let qrPollingInterval = null;
let qrCodeInstance = null;

function setupEventListeners() {
  const btnApply = document.getElementById('btn-apply-discount');
  if (btnApply) {
    btnApply.addEventListener('click', startEmployeeVerification);
  }

  const btnShowQr = document.getElementById('btn-show-qr');
  if (btnShowQr) {
    btnShowQr.addEventListener('click', openQrModal);
  }

  const btnCheckout = document.getElementById('btn-checkout');
  if (btnCheckout) {
    btnCheckout.addEventListener('click', handleCheckout);
  }
}

async function startEmployeeVerification() {
  const btn = document.getElementById('btn-apply-discount');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span>Connecting to Wallet...</span>`;

  try {
    saveCartState();

    const response = await fetch('/api/oid4vp/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        useCase: 'cart_discount',
        returnOrigin: window.location.origin
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const session = await response.json();
    console.log('[Store] Created OID4VP session:', session);

    // Direct redirection to wallet running at http://localhost:3001
    // Wallet handles selection and returns to our redirect_uri
    window.location.href = session.walletAuthUrl;
  } catch (err) {
    console.error('[Store] Verification error:', err);
    alert('Failed to connect to wallet. Ensure Docker containers are running.');
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function openQrModal() {
  const modal = document.getElementById('qr-modal');
  const qrContainer = document.getElementById('qrcode-container');
  const statusText = document.getElementById('qr-status-text');
  const spinner = document.getElementById('qr-loading-spinner');

  if (!modal || !qrContainer) return;

  // Clear any previous interval or QR
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
        useCase: 'cart_discount',
        returnOrigin: window.location.origin
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const session = await response.json();
    console.log('[Store] QR session created:', session);

    // Wallet scanner splits on '?' and forwards client_id and request_uri to /cb
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

    if (statusText) statusText.innerText = 'Waiting for wallet presentation...';

    startQrPolling(session.sessionId);
  } catch (err) {
    console.error('[Store] Error creating QR session:', err);
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

function startQrPolling(sessionId) {
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
        if (statusText) statusText.innerText = '✅ Badge verified successfully!';

        isEmployeeVerified = true;
        verifiedClaims = data.claims;

        setTimeout(() => {
          closeQrModal();
          renderCart();
        }, 800);
      }
    } catch (e) {
      console.warn('[Store] Polling error:', e);
    }
  }, 1200);
}

// ──────────────── FUTURE USE CASES ────────────────
async function simulateUseCase(useCaseName) {
  try {
    const response = await fetch('/api/oid4vp/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        useCase: useCaseName,
        returnOrigin: window.location.origin
      })
    });

    const session = await response.json();
    window.location.href = session.walletAuthUrl;
  } catch (err) {
    alert(`Could not initiate ${useCaseName} verification flow.`);
  }
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
