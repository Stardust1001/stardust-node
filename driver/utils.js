export const parseSelectors = selector => {
  return Array.isArray(selector) ? selector : selector.split('>>').map(ele => {
    const holders = [...ele.matchAll(/\[\[[^\]]+\]\]/g)].map(m => m[0])
    const options = {}
    holders.forEach(t => {
      ele = ele.replace(t, '')
      const parts = t.slice(2, -2).split('; ')
      parts.forEach(p => {
        let [key, value] = p.split('=')
        if (key === 'nth') value *= 1
        options[key] = value
      })
    })
    return [ele, options]
  })
}

export const chainLocator = (locator, options) => {
  if ('text' in options) {
    locator = locator.getByText(options.text)
  } else if ('eText' in options) {
    locator = locator.getByText(options.text, { exact: true })
  }
  locator = locator.nth(options.nth || 0)
  return locator
}

export const onError = (err, log = console.log) => {
  log('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  if (err?.stack) {
    log(err.stack.toString())
  } else if (err?.message) {
    log(err.message.toString())
  } else {
    log(err?.toString())
  }
}

export default {
  parseSelectors,
  chainLocator,
  onError
}
