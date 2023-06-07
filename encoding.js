import iconv from 'iconv-lite'

export const encode = (text, encoding) => {
  return iconv.encode(text, encoding)
}

export const decode = (text, encoding) => {
  return iconv.decode(Buffer.from(text), encoding)
}

export const transform = (text, fromEncoding, toEncoding) => {
  return encode(decode(text, fromEncoding), toEncoding)
}

export default {
  encode,
  decode,
  transform
}
