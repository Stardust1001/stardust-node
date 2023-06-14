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

export const onError = err => {
  console.log('0000000000000000000000000000')
  console.log(err)
}

export default {
  parseSelectors,
  chainLocator,
  onError
}
