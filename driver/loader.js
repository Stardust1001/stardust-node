import path from 'path'
import Papa from 'papaparse'
import Excel from 'exceljs'
import mammoth from 'mammoth'
import fsUtils from '../fsUtils.js'

export class Loader {
  static text (filepath, options) {
    return fsUtils.read(filepath)
  }

  static async json (filepath, options) {
    const text = await Loader.text(filepath, options)
    return JSON.parse(text || null)
  }

  static async csv (filepath, options) {
    const text = await Loader.text(filepath, options)
    return Papa.parse(text)
  }

  static async excel (filepath, options = {}) {
    let {
      sheetNames = ['Sheet1'],
      withHiddenRows = false,
      withHiddenCols = false,
      filterRow = true,
      fieldsDict = {}
    } = options
    const workbook = new Excel.Workbook()
    await workbook.xlsx.readFile(filepath)
    if (sheetNames === '*') {
      sheetNames = workbook.worksheets.map(ele => ele.name)
    } else {
      sheetNames = Array.isArray(sheetNames) ? sheetNames : [sheetNames]
    }
    return {
      workbook,
      sheets: sheetNames.map(name => {
        const sheet = workbook.getWorksheet(name)
        const list = () => {
          const hiddenColsIndices = sheet._columns.map((c, i) => [i, c.hidden]).filter(e => e[1]).map(e => e[0])
          const rows = []
          sheet._rows.forEach(row => {
            if (!withHiddenRows && row.hidden) return
            let values = []
            if (withHiddenCols || !hiddenColsIndices.length) {
              values = row.values
            } else {
              values = row.values.filter((v, i) => !hiddenColsIndices.includes(i))
            }
            rows.push(values.map(Loader.getCellValue))
          })
          return filterRow ? rows.filter(r => r.length) : rows
        }
        const json = () => {
          const rows = list()
          const headerIndex = options.headerRowIndex || 0
          const header = rows[headerIndex]
          const data = rows.slice(headerIndex + 1).map(r => {
            const dict = {}
            r.forEach((v, i) => dict[header[i]] = v)
            return dict
          })
          // const fields = [...header].filter(k => k)
          // const headerDict = {}
          // for (let key in fieldsDict) {
          //   headerDict[key] = fields.find(f => fieldsDict[key].some(d => f === d))
          //   headerDict[key] ||= fields.find(f => fieldsDict[key].some(d => f.includes(d)))
          //   if (!headerDict[key]) throw '表格里没找到 ' + fieldsDict[key].join('/') + ' 列'
          // }
          // data.forEach(row => {
          //   for (let key in headerDict) {
          //     row[key] = row[headerDict[key]]
          //   }
          // })
          return data
        }
        return { sheet, list, json }
      })
    }
  }

  static async doc (filepath, options = {}) {
    const { toHtml } = options
    if (toHtml) {
      return mammoth.convertToHtml({ path: filepath })
    }
    throw '不支持的Doc文件加载操作'
  }

  static getCellValue (value) {
    if (typeof value === 'string') {
      value = value.trim()
    } else if (value && typeof value === 'object') {
      if (value.richText) {
        value = value.richText.map(e => e.text).join('')
      } else if (value.text) {
        value = value.text
      } else if (value.result) {
        value = value.result
      }
    }
    return value
  }

  static TYPE_DICT = {
    json: 'json',
    xlsx: 'excel',
    docx: 'doc',
    csv: 'csv',
    txt: 'text'
  }

  static getFileType (filepath) {
    const extname = path.extname(filepath).slice(1).toLowerCase()
    return Loader.TYPE_DICT[extname] || 'text'
  }
}

export default Loader
