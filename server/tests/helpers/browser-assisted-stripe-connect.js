'use strict';

const puppeteer = require('puppeteer');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCookieHeaderValue(cookieHeader) {
  const header = String(cookieHeader || '').trim();
  if (!header) {
    return [];
  }

  return header
    .split(';')
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => {
      const eqIndex = part.indexOf('=');
      if (eqIndex <= 0) {
        return null;
      }
      return {
        name: part.slice(0, eqIndex).trim(),
        value: part.slice(eqIndex + 1).trim()
      };
    })
    .filter(Boolean);
}

function isTransientFrameError(err) {
  const message = String(err && err.message || err || '').toLowerCase();
  return message.includes('detached frame')
    || message.includes('execution context was destroyed')
    || message.includes('cannot find context with specified id')
    || message.includes('most likely because of a navigation');
}

async function detectCaptchaChallenge(page) {
  try {
    return await page.evaluate(() => {
      const bodyText = String(document.body && (document.body.innerText || document.body.textContent) || '').toLowerCase();
      const hasCaptchaText = bodyText.includes('captcha')
        || bodyText.includes('select all images')
        || bodyText.includes('verify you are human')
        || bodyText.includes('i am human')
        || bodyText.includes('security check');

      const frameSources = Array.from(document.querySelectorAll('iframe'))
        .map((frame) => String(frame.getAttribute('src') || '').toLowerCase());
      const hasCaptchaFrame = frameSources.some((src) => (
        src.includes('captcha')
        || src.includes('recaptcha')
        || src.includes('hcaptcha')
        || src.includes('arkoselabs')
        || src.includes('challenges.cloudflare.com')
      ));

      return hasCaptchaText || hasCaptchaFrame;
    });
  } catch (err) {
    if (isTransientFrameError(err)) {
      return false;
    }
    throw err;
  }
}

async function clickFirstMatchingText(page, textOptions) {
  const options = Array.isArray(textOptions) ? textOptions : [textOptions];
  try {
    return await page.evaluate((texts) => {
      const normalizedTexts = texts.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      const elements = Array.from(document.querySelectorAll(
        'button, a, label, [role="button"], [role="option"], input[type="button"], input[type="submit"]'
      ));
      const target = elements.find((element) => {
        const text = String(element.innerText || element.value || element.textContent || '').trim().toLowerCase();
        if (!text) {
          return false;
        }
        return normalizedTexts.some((needle) => text.includes(needle));
      });
      if (!target) {
        return '';
      }
      target.click();
      return String(target.innerText || target.value || target.textContent || '').trim();
    }, options);
  } catch (err) {
    if (isTransientFrameError(err)) {
      return '';
    }
    throw err;
  }
}

async function clickIfVisibleText(page, textOptions) {
  const clicked = await clickFirstMatchingText(page, textOptions);
  if (clicked) {
    await sleep(1000);
  }
  return clicked;
}

async function fillControl(page, matchers, value) {
  try {
    const result = await page.evaluate(({ candidates, nextValue }) => {
      const normalized = candidates.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
      const controls = Array.from(document.querySelectorAll('input, textarea, select'));

      function attributesFor(element) {
        const attrs = [
          element.id,
          element.name,
          element.getAttribute('placeholder'),
          element.getAttribute('aria-label'),
          element.getAttribute('autocomplete'),
          element.getAttribute('data-testid')
        ].filter(Boolean).map((item) => String(item).trim().toLowerCase());

        if (element.id) {
          const label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
          if (label) {
            attrs.push(String(label.innerText || label.textContent || '').trim().toLowerCase());
          }
        }

        let parent = element.parentElement;
        while (parent) {
          if (parent.tagName === 'LABEL') {
            attrs.push(String(parent.innerText || parent.textContent || '').trim().toLowerCase());
            break;
          }
          parent = parent.parentElement;
        }

        return attrs;
      }

      const target = controls.find((element) => {
        const tag = String(element.tagName || '').toLowerCase();
        const type = String(element.getAttribute('type') || '').toLowerCase();
        if (tag === 'input' && ['hidden', 'checkbox', 'radio'].includes(type)) {
          return false;
        }
        const attrs = attributesFor(element);
        return normalized.some((needle) => attrs.some((attr) => attr.includes(needle)));
      });

      if (!target) {
        return false;
      }

      target.focus();
      if (String(target.tagName || '').toLowerCase() === 'select') {
        const normalizedValue = String(nextValue).trim().toLowerCase();
        const option = Array.from(target.options || []).find((item) => {
          const text = String(item.text || '').trim().toLowerCase();
          const optionValue = String(item.value || '').trim().toLowerCase();
          return text === normalizedValue
            || optionValue === normalizedValue
            || text.includes(normalizedValue)
            || normalizedValue.includes(text)
            || optionValue.includes(normalizedValue)
            || normalizedValue.includes(optionValue);
        });
        if (option) {
          target.value = option.value;
        }
      } else {
        target.value = String(nextValue);
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.blur();
      return true;
    }, { candidates: matchers, nextValue: value });

    return result === true;
  } catch (err) {
    if (isTransientFrameError(err)) {
      return false;
    }
    throw err;
  }
}

async function tickAgreementBoxes(page) {
  try {
    return await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      let changed = false;
      for (const box of boxes) {
        const labelText = box.id
          ? String((document.querySelector('label[for="' + CSS.escape(box.id) + '"]') || {}).innerText || '').trim().toLowerCase()
          : '';
        const containerText = String((box.closest('label') || box.parentElement || {}).innerText || '').trim().toLowerCase();
        const text = labelText || containerText;
        if (text.includes('agree') || text.includes('accept') || text.includes('confirm') || text.includes('information is correct')) {
          if (box.checked !== true) {
            box.click();
            changed = true;
          }
        }
      }
      return changed;
    });
  } catch (err) {
    if (isTransientFrameError(err)) {
      return false;
    }
    throw err;
  }
}

async function handlePhoneNumberStep(page, diagnostics, options) {
  const clickedTestPhone = await clickIfVisibleText(page, [
    'use test phone number',
    'use a test phone number',
    'select test phone number',
    'test phone number'
  ]);
  if (clickedTestPhone) {
    diagnostics.clicks.push(clickedTestPhone);
  }

  await fillControl(page, ['country code', 'phone country code'], options.phoneCountryCode);
  await fillControl(page, ['phone number', 'mobile number', 'mobile phone', 'telephone', 'phone'], options.phoneNumber);

  const clickedVerifyPhone = await clickIfVisibleText(page, [
    'send code',
    'text me a code',
    'send text',
    'verify phone',
    'continue'
  ]);
  if (clickedVerifyPhone) {
    diagnostics.clicks.push(clickedVerifyPhone);
  }
}

async function isReturnUrl(page, returnUrlPrefix) {
  try {
    const currentUrl = String(page.url() || '');
    return currentUrl.startsWith(returnUrlPrefix) || currentUrl.includes('stripeConnect=return');
  } catch (err) {
    if (isTransientFrameError(err)) {
      return false;
    }
    throw err;
  }
}

async function completeStripeConnectOnboarding(optionsInput) {
  const options = Object.assign({
    onboardingUrl: '',
    returnUrlPrefix: '',
    appBaseUrl: '',
    sessionCookieHeader: '',
    timeoutMs: 8 * 60 * 1000,
    dobDay: '01',
    dobMonth: '01',
    dobYear: '1901',
    addressLine1: '4 Spicer Road',
    city: 'Exeter',
    postcode: 'EX11SX',
    country: 'United Kingdom',
    phoneCountryCode: '+44',
    phoneNumber: '07700900000',
    manualCaptchaTimeoutMs: 10 * 60 * 1000
  }, optionsInput || {});

  if (!options.onboardingUrl) {
    throw new Error('Stripe onboarding URL is required.');
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null
  });

  try {
    const page = await browser.newPage();
    const diagnostics = {
      clicks: [],
      pageErrors: [],
      requestFailures: [],
      consoleWarnings: []
    };

    page.on('pageerror', (err) => {
      diagnostics.pageErrors.push(String(err && err.message || err || 'Unknown page error'));
    });

    page.on('requestfailed', (request) => {
      const failure = request && request.failure ? request.failure() : null;
      diagnostics.requestFailures.push(
        String(request && request.method ? request.method() : 'GET')
        + ' ' + String(request && request.url ? request.url() : '')
        + ' failed: '
        + String(failure && failure.errorText || 'unknown failure')
      );
    });

    page.on('console', (msg) => {
      const type = String(msg && msg.type ? msg.type() : '').trim().toLowerCase();
      if (type === 'warning' || type === 'error') {
        diagnostics.consoleWarnings.push('[' + type + '] ' + String(msg.text ? msg.text() : ''));
      }
    });

    const cookieUrlSource = options.appBaseUrl || options.returnUrlPrefix || options.onboardingUrl;
    const cookieUrl = new URL(cookieUrlSource).origin;
    const cookies = parseCookieHeaderValue(options.sessionCookieHeader);
    if (cookies.length) {
      await page.setCookie(...cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: cookieUrl,
        httpOnly: false,
        secure: cookieUrl.startsWith('https://'),
        sameSite: 'Lax'
      })));
    }

    await page.goto(options.onboardingUrl, { waitUntil: 'networkidle2', timeout: options.timeoutMs });

    const deadline = Date.now() + options.timeoutMs;
    let captchaLoggedAt = 0;
    while (Date.now() < deadline) {
      if (await isReturnUrl(page, options.returnUrlPrefix)) {
        return {
          completed: true,
          returnUrl: page.url(),
          diagnostics
        };
      }

      const captchaVisible = await detectCaptchaChallenge(page);
      if (captchaVisible) {
        if (!captchaLoggedAt) {
          captchaLoggedAt = Date.now();
          console.log('[Stripe Connect Helper] CAPTCHA detected. Complete it manually in the opened browser window; the script will resume automatically.');
        }

        if (Date.now() - captchaLoggedAt > options.manualCaptchaTimeoutMs) {
          throw new Error('CAPTCHA challenge was not completed within the manual timeout window.');
        }

        await sleep(1500);
        continue;
      }
      captchaLoggedAt = 0;

      const clickedTestData = await clickIfVisibleText(page, [
        'use test data',
        'fill with test data',
        'use stripe-provided test data',
        'test data'
      ]);
      if (clickedTestData) {
        diagnostics.clicks.push(clickedTestData);
      }

      await fillControl(page, ['date of birth day', 'birth day', 'day'], options.dobDay);
      await fillControl(page, ['date of birth month', 'birth month', 'month'], options.dobMonth);
      await fillControl(page, ['date of birth year', 'birth year', 'year'], options.dobYear);
      await fillControl(page, ['date of birth', 'dob'], options.dobDay + '/' + options.dobMonth + '/' + options.dobYear);
      await fillControl(page, ['address line 1', 'street address', 'line 1', 'address'], options.addressLine1);
      await fillControl(page, ['city', 'town'], options.city);
      await fillControl(page, ['postcode', 'postal code', 'zip'], options.postcode);
      await fillControl(page, ['country'], options.country);
      await handlePhoneNumberStep(page, diagnostics, options);
      await tickAgreementBoxes(page);

      const clickedAction = await clickIfVisibleText(page, [
        'continue',
        'next',
        'submit',
        'complete',
        'finish',
        'agree and submit',
        'done',
        'return to automaticpeople',
        'simulate'
      ]);
      if (clickedAction) {
        diagnostics.clicks.push(clickedAction);
      }

      try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 3000 });
      } catch (err) {
        if (!isTransientFrameError(err)) {
        }
      }
      await sleep(1000);
    }

    throw new Error(
      'Stripe onboarding did not reach the return URL before timeout.'
      + (diagnostics.pageErrors.length ? ' Page errors: ' + diagnostics.pageErrors.slice(0, 3).join(' | ') : '')
      + (diagnostics.consoleWarnings.length ? ' Console warnings: ' + diagnostics.consoleWarnings.slice(0, 3).join(' | ') : '')
      + (diagnostics.requestFailures.length ? ' Request failures: ' + diagnostics.requestFailures.slice(0, 3).join(' | ') : '')
    );
  } finally {
    await browser.close();
  }
}

module.exports = {
  completeStripeConnectOnboarding
};
