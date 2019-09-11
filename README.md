# Only One Tab

[![Greenkeeper badge](https://badges.greenkeeper.io/KayleePop/only-one-tab.svg)](https://greenkeeper.io/) [![Travis badge](https://travis-ci.org/KayleePop/only-one-tab.svg?branch=master)](https://travis-ci.org/KayleePop/only-one-tab) [![standard badge](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com) [![npm](https://img.shields.io/npm/v/only-one-tab.svg)](https://www.npmjs.com/package/only-one-tab)

Run a function in exactly one open tab, switching to another if closed.

## Goals

- Robust across browsers
- Fully tested

## Usage

```javascript
const onlyOneTab = require('only-one-tab')

// only one daemon will run at a time across all tabs
onlyOneTab(() => {
  startDaemon()
})
```

## API

### `onlyOneTab(cb)`

The callback is run only once per tab, and on exactly one tab at a time. When the actor tab that ran the callback is closed, then exactly one other open tab runs its callback to replace it as the actor.

## Recovery

After a browser crash, or something similar that causes the acting tab to close without properly resetting and allowing another to replace it, a refresh or new tab will check for a heartbeat and force a reset.
