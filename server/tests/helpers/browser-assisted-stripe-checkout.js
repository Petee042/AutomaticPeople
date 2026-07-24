'use strict';

const puppeteer = require('puppeteer');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    status: 'timeout'
  };
}

async function completeStripeCheckout(optionsInput) {
  const options = Object.assign({
    checkoutUrl: '',
    successUrlNeedle: 'payment=success',
    timeoutMs: 180000,
    headless: true,
    email: '',
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
