// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/

const test = require('muggle-test')
const assert = require('muggle-assert')
const puppeteer = require('puppeteer')

const sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// rejects after 10 seconds
async function rejectAfter10s (error) {
  await sleep(10 * 1000)
  throw error
}

// returns tab object
// {
//   page: (puppeteer page for this tab),
//   isActing: (has the onlyOneTab callback been run yet?)
//   actingPromise: (promise for when the onlyOneTab callback runs)
// }
async function newTab (browser) {
  const page = await browser.newPage()

  // this html file loads ./bundle.js which is ./only-one-tab.js browserified
  // -r is used to allow window.require('only-one-tab') in other script
  await page.goto(`file://${require.resolve('./test.html')}`)

  const tab = {
    page: page,
    isActing: false
  }

  // create deffered promise
  tab.actingPromise = new Promise((resolve) => {
    tab.resolveActingPromise = resolve
  })

  // allow this function to be remotely called from the page with window.nowActing()
  await page.exposeFunction('nowActing', () => {
    tab.isActing = true
    tab.resolveActingPromise()
  })

  // execute toRunOnPage() on the page's thread
  await page.addScriptTag({ content: `(${toRunOnPage.toString()})()` })
  function toRunOnPage () {
    const onlyOneTab = require('only-one-tab')

    onlyOneTab(() => {
      // console logs for debugging with devtools
      console.log('this tab started acting at ', new Date())

      window.nowActing()
    })
  }

  return tab
}

test('a closing tab should successfully signal only one new actor', async () => {
  const browser = await puppeteer.launch()

  // open 100 tabs
  const tabPromises = []
  for (let i = 0; i < 100; i++) {
    tabPromises.push(newTab(browser))
  }
  const tabs = await Promise.all(tabPromises)

  // repeat to ensure consistency
  for (let i = 0; i < 100; i++) {
    // wait for a tab to become actor
    await Promise.race([
      rejectAfter10s(new Error('timed out waiting for new tab to become actor')),
      ...tabs.map((tab) => tab.actingPromise)
    ])

    // wait for any other tabs to finish becoming actors
    await sleep(100)

    const actingTabs = tabs.filter((tab) => tab.isActing === true)
    assert.equal(actingTabs.length, 1, 'there should be exactly one actor')

    // close the acting tab and remove from tabs[]
    const actingIndex = tabs.findIndex((tab) => tab.isActing === true)
    await tabs[actingIndex].page.close({ runBeforeUnload: true })
    tabs.splice(actingIndex, 1)

    // keep same number of tabs for next iteration
    tabs.push(await newTab(browser))
  }

  browser.close()
})

test('closing non-acting tabs should not signal more actors', async () => {
  const browser = await puppeteer.launch()

  const actor = await newTab(browser)
  await actor.actingPromise

  const tabPromises = []
  for (let i = 0; i < 100; i++) {
    tabPromises.push(newTab(browser))
  }
  const nonActingTabs = await Promise.all(tabPromises)

  // restart many non-acting tabs
  for (let i = 0; i < 100; i++) {
    // close random non acting tab and remove from array
    const randomTabIndex = Math.floor(Math.random() * nonActingTabs.length)
    await nonActingTabs[randomTabIndex].page.close({ runBeforeUnload: true })
    nonActingTabs.splice(randomTabIndex, 1)

    // replace closed tab
    nonActingTabs.push(await newTab(browser))
  }

  // wait for any tabs to finish becoming actors
  await sleep(2 * 1000)

  for (const nonActingTab of nonActingTabs) {
    assert(!nonActingTab.isActing, 'non-acting tabs should not be acting')
  }

  browser.close()
})

// this reliably tests recovery from getting stuck
test('quickly close lots of tabs at once including the actor', async () => {
  const browser = await puppeteer.launch()

  // open 199 tabs
  const tabPromises = []
  for (let i = 0; i < 199; i++) {
    tabPromises.push(newTab(browser))
  }

  const tabsToClose = await Promise.all(tabPromises)

  // wait for an actor
  await Promise.race([
    rejectAfter10s(new Error('timed out waiting for initial tab to become actor')),
    ...tabsToClose.map((tab) => tab.actingPromise)
  ])

  const nonActor = await newTab(browser)

  // close all tabs but nonActor concurrently
  await Promise.all(
    tabsToClose.map((tab) => tab.page.close({ runBeforeUnload: true }))
  )

  // wait out the heartbeat timeout + maximum polling delay
  await sleep(4 * 1000)

  // wait for nonActor to act
  await Promise.race([
    rejectAfter10s(new Error('last tab should act')),
    nonActor.actingPromise
  ])

  browser.close()
})

test('should work when site is reopened', async () => {
  const browser = await puppeteer.launch()

  const tab = await newTab(browser)

  // wait for action
  await tab.actingPromise

  await tab.page.close({ runBeforeUnload: true })

  // make sure the last tab fully closes
  await sleep(100)

  const tab2 = await newTab(browser)

  await Promise.race([
    rejectAfter10s(new Error('timed out waiting for new tab to act')),
    tab2.actingPromise
  ])

  browser.close()
})

test('should recover from crash with exactly one actor', async () => {
  const browser = await puppeteer.launch()

  const crashTab = await newTab(browser)

  // wait until crashTab is the actor
  await crashTab.actingPromise

  crashTab.page.on('error', () => {}) // this prevents unhandled rejection from crash

  // simulate browser crash
  crashTab.page.goto('chrome://crash')
    .catch(() => {}) // swallow errors

  // allow heartbeat to time out
  await sleep(3 * 1000)

  const tabPromises = []
  for (let i = 0; i < 100; i++) {
    // open many tabs concurrently to ensure that the reset doesn't cause multiple actors
    tabPromises.push(newTab(browser))
  }

  const tabs = await Promise.all(tabPromises)

  // wait for an actor
  await Promise.race([
    rejectAfter10s(new Error('timed out waiting for new tab to act')),
    ...tabs.map((tab) => tab.actingPromise)
  ])

  // wait for any other tabs to start acting
  await sleep(2 * 1000)

  const actors = tabs.filter((tab) => tab.isActing === true)
  assert.equal(actors.length, 1, 'there should be exactly one actor')

  browser.close()
})
