// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/

const test = require('muggle-test')
const assert = require('muggle-assert')
const puppeteer = require('puppeteer')

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function runOnPage (page, asyncFunc) {
  // this html file loads ./bundle.js which is ./only-one-tab.js browserified
  // -r is used to allow window.require('only-one-tab') in other script
  await page.goto(`file://${require.resolve('./test.html')}`)

  return new Promise((resolve, reject) => {
    page.exposeFunction('resolveNodePromise', resolve)
      .then(() => page.exposeFunction('rejectNodePromise', reject))
      .then(() => page.addScriptTag({
        // immediately invoke passed function on the page and wait for it to resolve
        content:
        `(${asyncFunc.toString()})()
          .then(window.resolveNodePromise)
          .catch(window.rejectNodePromise)`
      }))
      .catch(reject)
  })
}

async function newTab (browser) {
  const page = await browser.newPage()

  const tab = {
    page: page,
    isActing: false
  }

  tab.promise = runOnPage(page, async () => {
    const onlyOneTab = require('only-one-tab')

    await new Promise((resolve) => onlyOneTab(resolve))
  })
  // .then is required because the above async function runs on the page not here
    .then(() => {
      // set isActing to true after the onlyOneTab() callback runs
      tab.isActing = true
    })

  return tab
}

test('open 20 tabs, then close each actor tab in sequence', async () => {
  const browser = await puppeteer.launch()

  // repeat for consistency
  for (let i = 0; i < 10; i++) {
    const tabs = []

    for (let i = 0; i < 20; i++) {
      const tab = await newTab(browser)
      tabs.push(tab)
    }

    while (tabs.length > 0) {
      // wait for a tab to become actor
      await Promise.race(tabs.map((tab) => tab.promise))

      const actingTabs = tabs.filter((tab) => tab.isActing === true)
      assert.equal(actingTabs.length, 1, 'there should be exactly one actor')

      // close the acting tab and remove from tabs[]
      const actingIndex = actingTabs.findIndex((tab) => tab.isActing === true)
      await tabs[actingIndex].page.close({ runBeforeUnload: true })
      tabs.splice(actingIndex, 1)
    }
  }

  browser.close()
})

test('open 20 tabs, then close them randomly', async () => {
  const browser = await puppeteer.launch()

  // repeat for consistency
  for (let i = 0; i < 10; i++) {
    const tabs = []

    for (let i = 0; i < 20; i++) {
      const tab = await newTab(browser)
      tabs.push(tab)
    }

    while (tabs.length > 0) {
      // wait until any tab is an actor
      await Promise.race(tabs.map((tab) => tab.promise))

      const actingTabs = tabs.filter((tab) => tab.isActing === true)
      assert.equal(actingTabs.length, 1, 'there should be exactly one actor')

      const randomTabIndex = Math.floor(Math.random() * tabs.length)

      // close random tab
      await tabs[randomTabIndex].page.close({ runBeforeUnload: true })

      // remove closed tab from tabs[]
      tabs.splice(randomTabIndex, 1)
    }
  }

  browser.close()
})

test('should reset after last tab closed', async () => {
  const browser = await puppeteer.launch()

  const tab = await newTab(browser)

  // wait for action
  await tab.promise

  await tab.page.close({ runBeforeUnload: true })

  const tab2 = await newTab(browser)

  async function timeout () {
    await sleep(10 * 1000)
    throw new Error('timed out')
  }

  await Promise.race([timeout(), tab2.promise])

  browser.close()
})

test('should recover from crash with exactly one actor', async () => {
  const browser = await puppeteer.launch()

  const crashTab = await newTab(browser)

  // wait until crashTab is the actor
  await crashTab.promise

  crashTab.page.on('error', () => {}) // this prevents unhandled rejection from crash

  // simulate browser crash
  crashTab.page.goto('chrome://crash')
    .catch(() => {}) // swallow errors

  // allow heartbeat to time out
  await sleep(3 * 1000)

  const tabPromises = []
  for (let i = 0; i < 100; i++) {
    // create all tabs in parallel to allow them to compete for actor
    tabPromises.push(newTab(browser))
  }

  const tabs = await Promise.all(tabPromises)

  // wait 10 seconds to ensure everything is settled
  await sleep(10 * 1000)

  const actors = tabs.filter((tab) => tab.isActing === true)
  assert.equal(actors.length, 1, 'there should be exactly one actor')

  browser.close()
})
