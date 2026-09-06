'use strict';

const puppeteer = require('puppeteer');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickFirstMatchingText(page, textOptions) {
  const options = Array.isArray(textOptions) ? textOptions : [textOptions];

  try {
    const frames = page.frames();
    for (const frame of frames) {
      const clicked = await frame.evaluate((texts) => {
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

      if (clicked) {
        return clicked;
      }
    }
  } catch {
    return '';
  }
}

async function fillControl(page, matchers, value) {
  try {
    const frames = page.frames();
    for (const frame of frames) {
      const filled = await frame.evaluate(({ candidates, nextValue }) => {
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

      if (filled) {
        return true;
      }
    }
  } catch {
    return false;
  }
}

async function typeIntoFirstMatch(page, selectors, value, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const options = Array.isArray(selectors) ? selectors : [selectors];

  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const frame of frames) {
      for (const selector of options) {
        try {
          const handle = await frame.$(selector);
          if (!handle) {
            continue;
          }

          await handle.click({ clickCount: 3 });
          await handle.type(String(value || ''), { delay: 20 });
          return true;
        } catch {
          // Ignore transient frame/input failures while checkout boots.
        }
      }
    }

    await sleep(250);
  }

  return false;
}

async function clickPayButton(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  const buttonSelectors = [
    'button[type="submit"]',
    'button[data-testid*="submit"]',
    'button[data-testid*="pay"]'
  ];

  while (Date.now() < deadline) {
    const frames = page.frames();
    for (const frame of frames) {
      for (const selector of buttonSelectors) {
        try {
          const handle = await frame.$(selector);
          if (!handle) {
            continue;
          }

          await handle.click();
          return true;
        } catch {
          // Continue trying other selectors/frames.
        }
      }

      try {
        const clicked = await frame.evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
          const target = candidates.find((element) => {
            const text = String(element.innerText || element.value || element.textContent || '').trim().toLowerCase();
            return text.includes('pay') || text.includes('complete payment');
          });
          if (!target) {
            return false;
          }
          target.click();
          return true;
        });
        if (clicked) {
          return true;
        }
      } catch {
        // Ignore transient cross-frame errors.
      }
    }

    await sleep(250);
  }

  return false;
}

async function waitForResultUrl(page, successNeedle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const successToken = String(successNeedle || 'payment=success').trim().toLowerCase();

  while (Date.now() < deadline) {
    const currentUrl = String(page.url() || '');
    const lowered = currentUrl.toLowerCase();

    if (successToken && lowered.includes(successToken)) {
      return {
        completed: true,
        finalUrl: currentUrl,
        status: 'success'
      };
    }

    if (lowered.includes('payment=cancelled') || lowered.includes('payment=failed')) {
      return {
        completed: false,
        finalUrl: currentUrl,
        status: 'cancelled_or_failed'
      };
    }

    await sleep(500);
  }

  return {
    completed: false,
    finalUrl: String(page.url() || ''),
    status: 'timeout',
    diagnostics: await collectCheckoutDiagnostics(page)
  };
}

async function collectCheckoutDiagnostics(page) {
  try {
    const frameDetails = [];
    for (const frame of page.frames()) {
      try {
        const detail = await frame.evaluate(() => {
          const text = String(document.body && (document.body.innerText || document.body.textContent) || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1200);
          const invalidFields = Array.from(document.querySelectorAll('input, select, textarea'))
            .filter((element) => {
              const ariaInvalid = String(element.getAttribute('aria-invalid') || '').trim().toLowerCase();
              return ariaInvalid === 'true';
            })
            .map((element) => ({
              name: String(element.getAttribute('name') || element.getAttribute('autocomplete') || element.id || element.type || '').trim(),
              placeholder: String(element.getAttribute('placeholder') || '').trim(),
              ariaLabel: String(element.getAttribute('aria-label') || '').trim()
            }))
            .slice(0, 10);

          return {
            url: String(location.href || ''),
            title: String(document.title || ''),
            text,
            invalidFields
          };
        });
        frameDetails.push(detail);
      } catch {
        // Ignore inaccessible frame diagnostics.
      }
    }
    return frameDetails;
  } catch {
    return [];
  }
}

async function completeStripeCheckout(optionsInput) {
  const options = Object.assign({
    checkoutUrl: '',
    successUrlNeedle: 'payment=success',
    timeoutMs: 180000,
    headless: true,
    email: '',
    phone: '07812582241',
    addressLine1: '4 Spicer Road',
    city: 'Exeter',
    country: 'United Kingdom',
    postcode: 'EX11SX',
    cardNumber: '4242424242424242',
    cardExpiry: '1234',
    cardCvc: '123',
    cardName: 'AutomaticPeople Test'
  }, optionsInput || {});

  if (!options.checkoutUrl) {
    throw new Error('Stripe checkout URL is required.');
  }

  const browser = await puppeteer.launch({
    headless: options.headless !== false,
    defaultViewport: {
      width: 1400,
      height: 950
    }
  });

  try {
    const page = await browser.newPage();
    await page.goto(options.checkoutUrl, { waitUntil: 'networkidle2', timeout: options.timeoutMs });

    if (options.email) {
      await typeIntoFirstMatch(
        page,
        [
          'input[type="email"]',
          'input[autocomplete="email"]',
          'input[name="email"]'
        ],
        options.email,
        12000
      );
    }

    await typeIntoFirstMatch(
      page,
      [
        'input[type="tel"]',
        'input[name="phoneNumber"]',
        'input[name="phone"]',
        'input[autocomplete="tel"]'
      ],
      options.phone,
      8000
    );

    await typeIntoFirstMatch(
      page,
      [
        'input[name="billingAddressLine1"]',
        'input[name="addressLine1"]',
        'input[autocomplete="address-line1"]',
        'input[placeholder*="Address line 1"]',
        'input[placeholder*="Street address"]'
      ],
      options.addressLine1,
      8000
    );

    await typeIntoFirstMatch(
      page,
      [
        'input[name="billingAddressCity"]',
        'input[name="city"]',
        'input[autocomplete="address-level2"]',
        'input[placeholder*="City"]',
        'input[placeholder*="Town"]'
      ],
      options.city,
      8000
    );

    await fillControl(
      page,
      [
        'select[name="country"]',
        'select[autocomplete="country"]',
        'input[name="country"]',
        'input[autocomplete="country"]',
        'input[placeholder*="country"]',
        'select[aria-label*="country"]'
      ],
      options.country
    );

    await fillControl(
      page,
      [
        'input[name="postalCode"]',
        'input[name="postcode"]',
        'input[autocomplete="postal-code"]',
        'input[autocomplete="zip-code"]',
        'input[placeholder*="postcode"]',
        'input[placeholder*="postal"]'
      ],
      options.postcode
    );

    const numberOk = await typeIntoFirstMatch(
      page,
      [
        'input[name="cardNumber"]',
        'input[name="number"]',
        'input[autocomplete="cc-number"]',
        'input[data-elements-stable-field-name="cardNumber"]'
      ],
      options.cardNumber,
      30000
    );
    if (!numberOk) {
      throw new Error('Could not find Stripe card number input in checkout UI.');
    }

    const expiryOk = await typeIntoFirstMatch(
      page,
      [
        'input[name="cardExpiry"]',
        'input[name="expiry"]',
        'input[autocomplete="cc-exp"]',
        'input[data-elements-stable-field-name="cardExpiry"]'
      ],
      options.cardExpiry,
      30000
    );
    if (!expiryOk) {
      throw new Error('Could not find Stripe card expiry input in checkout UI.');
    }

    const cvcOk = await typeIntoFirstMatch(
      page,
      [
        'input[name="cardCvc"]',
        'input[name="cvc"]',
        'input[autocomplete="cc-csc"]',
        'input[data-elements-stable-field-name="cardCvc"]'
      ],
      options.cardCvc,
      30000
    );
    if (!cvcOk) {
      throw new Error('Could not find Stripe card CVC input in checkout UI.');
    }

    await typeIntoFirstMatch(
      page,
      [
        'input[name="billingName"]',
        'input[name="cardholderName"]',
        'input[autocomplete="cc-name"]',
        'input[placeholder*="Name"]'
      ],
      options.cardName,
      8000
    );

    await clickFirstMatchingText(page, [
      'yes',
      'yes please',
      'save',
      'save card',
      'save payment details',
      'save card details',
      'save and continue',
      'yes, save',
      'allow',
      'continue',
      'agree',
      'confirm'
    ]);

    const clickedPay = await clickPayButton(page, 30000);
    if (!clickedPay) {
      throw new Error('Could not find or click Stripe Pay button.');
    }

    return await waitForResultUrl(page, options.successUrlNeedle, options.timeoutMs);
  } finally {
    await browser.close();
  }
}

module.exports = {
  completeStripeCheckout
};
