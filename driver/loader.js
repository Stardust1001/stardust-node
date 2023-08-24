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
    let { sheetNames = ['Sheet1'], withHidden = false } = options
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
          const rows = withHidden ? sheet.getSheetValues() : sheet._rows.filter(r => !r.hidden).map(r => r.values)
          for (let i = 0, rowCount = rows.length; i < rowCount; i++) {
            rows[i] ??= []
            for (let j = 0, cellCount = rows[i].length; j < cellCount; j++) {
              rows[i][j] = Loader.getCellValue(rows[i][j])
            }
          }
          return rows.filter(r => r.length)
        }
        const json = () => {
          const rows = list()
          const headerIndex = options.headerRowIndex || 0
          const header = rows[headerIndex]
          return rows.slice(headerIndex + 1).map(r => {
            const dict = {}
            r.forEach((v, i) => dict[header[i]] = v)
            return dict
          })
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
