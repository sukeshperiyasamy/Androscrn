/**
 * AndroScrn Documentation & Landing Page
 * Progressive Enhancements: Copy buttons, Mobile navigation, FAQ accordions,
 * ScrollSpy, and Interactive Concept Demos.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Copy to Clipboard for Terminal & Code Panels
  initCodeCopyButtons();

  // 2. Mobile Menu Navigation
  initMobileNav();

  // 3. FAQ Accordion
  initFaqAccordion();

  // 4. ScrollSpy for Sticky Navigation
  initScrollSpy();

  // 5. Interactive Camera Studio Mockup Slider & Toggles
  initCameraStudioMockup();

  // 6. Interactive About & Legal Section Tabs
  initAboutTabs();
});

/**
 * Initializes clipboard copying on code blocks
 */
function initCodeCopyButtons() {
  const copyButtons = document.querySelectorAll('.copy-btn');

  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const codeBlock = btn.closest('.code-block');
      if (!codeBlock) return;

      const codeElement = codeBlock.querySelector('.code-body code') || codeBlock.querySelector('.code-body');
      if (!codeElement) return;

      // Extract text content, stripping extraneous empty lines
      const codeText = codeElement.innerText.trim();

      try {
        await navigator.clipboard.writeText(codeText);
        const originalText = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>Copied!`;
        btn.style.borderColor = 'var(--accent-emerald)';
        btn.style.color = 'var(--accent-emerald)';

        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.borderColor = '';
          btn.style.color = '';
        }, 2200);
      } catch (err) {
        console.error('Failed to copy to clipboard', err);
        btn.textContent = 'Failed';
        setTimeout(() => {
          btn.textContent = 'Copy';
        }, 2000);
      }
    });
  });
}

/**
 * Initializes mobile responsive navigation toggle
 */
function initMobileNav() {
  const toggleBtn = document.querySelector('.mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');

  if (!toggleBtn || !navLinks) return;

  toggleBtn.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggleBtn.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  });

  // Close when clicking any nav anchor link
  navLinks.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      if (navLinks.classList.contains('open')) {
        navLinks.classList.remove('open');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Close on Escape key press
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('open')) {
      navLinks.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.focus();
    }
  });
}

/**
 * Initializes accordion behavior on FAQ items
 */
function initFaqAccordion() {
  const faqItems = document.querySelectorAll('.faq-item');

  faqItems.forEach((item) => {
    const questionBtn = item.querySelector('.faq-question');
    if (!questionBtn) return;

    questionBtn.addEventListener('click', () => {
      const isAlreadyOpen = item.classList.contains('open');

      // Optional: Close sibling items for single-accordion feel
      faqItems.forEach((sibling) => {
        if (sibling !== item && sibling.classList.contains('open')) {
          sibling.classList.remove('open');
          sibling.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
        }
      });

      if (isAlreadyOpen) {
        item.classList.remove('open');
        questionBtn.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('open');
        questionBtn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/**
 * Observes sections and highlights corresponding active link in navigation
 */
function initScrollSpy() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  if (!('IntersectionObserver' in window) || sections.length === 0) return;

  const observerOptions = {
    root: null,
    rootMargin: '-20% 0px -70% 0px',
    threshold: 0
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach((link) => {
          const href = link.getAttribute('href');
          if (href === `#${id}`) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    });
  }, observerOptions);

  sections.forEach((sec) => observer.observe(sec));
}

/**
 * Interactive concept demo for Camera Studio console mockup
 */
function initCameraStudioMockup() {
  const zoomSlider = document.getElementById('camera-zoom-slider');
  const zoomVal = document.getElementById('camera-zoom-value');
  const reticle = document.getElementById('camera-preview-reticle');
  const torchBtn = document.getElementById('camera-torch-toggle');
  const torchStatus = document.getElementById('camera-torch-status');
  const lensSelect = document.getElementById('camera-lens-select');
  const lensLabel = document.getElementById('camera-hud-lens');

  if (zoomSlider && zoomVal && reticle) {
    zoomSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value).toFixed(1);
      zoomVal.textContent = `${val}x`;
      // Scale reticle inversely or dynamically to simulate camera zoom
      const scale = 1 + (val - 1) * 0.12;
      reticle.style.transform = `scale(${scale})`;
    });
  }

  if (torchBtn && torchStatus) {
    torchBtn.addEventListener('click', () => {
      const isTorchOn = torchBtn.classList.toggle('active');
      torchStatus.textContent = isTorchOn ? 'ON' : 'OFF';
      torchStatus.style.color = isTorchOn ? 'var(--accent-amber)' : 'var(--text-secondary)';
      torchBtn.style.borderColor = isTorchOn ? 'var(--accent-amber)' : '';
      torchBtn.style.color = isTorchOn ? 'var(--accent-amber)' : '';
    });
  }

  if (lensSelect && lensLabel) {
    lensSelect.addEventListener('change', (e) => {
      lensLabel.textContent = e.target.value;
    });
  }
}

/**
 * Tab switching for About & Legal section
 */
function initAboutTabs() {
  const tabs = document.querySelectorAll('.about-tab-btn');
  const panels = document.querySelectorAll('.about-panel');
  if (!tabs.length || !panels.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('aria-controls');
      tabs.forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      panels.forEach((p) => {
        p.classList.remove('active');
      });

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });

  // Handle direct hash navigation to specific about sub-tabs (e.g. #about-privacy, #about-terms)
  function handleHash() {
    const hash = window.location.hash;
    if (!hash) return;
    const matchingTab = Array.from(tabs).find((t) => {
      const target = t.getAttribute('aria-controls');
      return `#${target}` === hash || `#about-${target.replace('about-panel-', '')}` === hash;
    });
    if (matchingTab) {
      matchingTab.click();
      const aboutSec = document.getElementById('about');
      if (aboutSec) {
        aboutSec.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  window.addEventListener('hashchange', handleHash);
  if (window.location.hash) {
    handleHash();
  }
}

