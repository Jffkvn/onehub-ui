import { expect, it } from 'vitest'
import { prepareBulkWorkbook } from './bulkWorkbook'

it('uses the reference item master template and orders category and item writes by type', () => {
  const template = ['Type', 'Name', 'Description', 'SKU', 'Unit of Measure', 'Reorder Level', 'Serial Number', 'Model Name', 'Is Sensitive', 'Current Warehouse Name', 'Condition Notes']
  expect(prepareBulkWorkbook('item_master', 'Item Master Upload', [
    template,
    ['consumable', 'Cable', 'Fiber', 'cab-1', 'metre', '2'],
    ['category', 'Fiber', 'Installation materials'],
  ]).command).toEqual({
    name: 'rpc_bulk_import_item_master',
    args: {
      p_categories: [{ name: 'Fiber', description: 'Installation materials' }],
      p_consumables: [{ name: 'Cable', sku: 'CAB-1', category_name: 'Fiber', unit_of_measure: 'metre', reorder_level: 2 }],
      p_equipment: [],
    },
  })
})

it('never produces write arguments for invalid records and preserves their worksheet row numbers', () => {
  const preview = prepareBulkWorkbook('stock_adjustment', 'Stock Adjustment Upload', [
    ['Warehouse Name', 'SKU or Serial', 'Quantity', 'Reason'], [],
    ['Main depot', 'CAB-1', '0', ''],
  ])
  expect(preview.command).toBeNull()
  expect(preview.errors).toEqual([
    { row: 3, message: 'Enter a non-zero whole number for Quantity.' },
    { row: 3, message: 'Reason is required.' },
  ])
})

it('rejects a workbook for a different operation', () => {
  expect(() => prepareBulkWorkbook('opening_stock', 'Goods Received Upload', [])).toThrow('Opening Stock Upload')
})

it('previews signed adjustments without changing their sign', () => {
  const preview = prepareBulkWorkbook('stock_adjustment', 'Stock Adjustment Upload', [
    ['Warehouse Name', 'SKU or Serial', 'Quantity', 'Reason'],
    ['Main depot', 'CAB-1', '-2', 'Damaged packaging'],
  ])
  expect(preview.command).toEqual({
    name: 'rpc_bulk_adjust_stock',
    args: { p_rows: [{ warehouse_name: 'Main depot', sku_or_serial: 'CAB-1', quantity: -2, reason: 'Damaged packaging' }] },
  })
})

it('imports amounts with Excel thousands grouping without changing their values', () => {
  const preview = prepareBulkWorkbook('goods_received', 'Goods Received Upload', [
    ['Receipt Reference', 'Warehouse Name', 'SKU or Serial', 'Quantity', 'Unit Price'],
    ['GRN-1', 'Main depot', 'CAB-1', '1,000', '35,000.50'],
  ])
  expect(preview.command).toEqual({
    name: 'rpc_bulk_receive_stock',
    args: { p_rows: [{ receipt_reference: 'GRN-1', warehouse_name: 'Main depot', sku_or_serial: 'CAB-1', quantity: 1000, unit_price: 35000.50 }] },
  })
})
