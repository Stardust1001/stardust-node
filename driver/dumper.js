import Papa from 'papaparse'
import Excel from 'exceljs'
import encoding from '../encoding.js'
import fsUtils from '../fsUtils.js'

export class Dumper {
  static text (data, filepath, options) {
    return fsUtils.write(filepath, data, options)
  }

  static json (data, filepath, options) {
    const text = JSON.stringify(data, null, 2)
    return Dumper.text(text, filepath, options)
  }

  static  csv (data, filepath, options) {
    const text = encoding.transform(Papa.unparse(data), 'utf-8', 'gbk')
    return Dumper.text(text, filepath, options)
  }

  static excel (data, filepath, options) {
    const workbook = Dumper.json2Excel(data, options.header)
    return workbook.xlsx.writeFile(filepath)
  }

  static json2Excel (list, header) {
    const workbook = new Excel.Workbook()
    const sheet = workbook.addWorksheet('Sheet1', {})
    if (header) {
      sheet.addRow(header)
    } else if (!Array.isArray(list[0])) {
      sheet.addRow(Object.keys(list[0]))
    }
    sheet.addRows(list.map(row => Object.values(row)))
    return workbook
  }
}

export default Dumper
