// سجلّ الوحدات: كل وحدة تضيف شاشاتها هنا. وحدة جديدة = مجلد جديد + سطر هنا، دون لمس الوحدات الأخرى.
import { renderHome } from './home/home.js';
import { renderSale } from './sale/sale.js';
import { renderReturns } from './sale/returns.js';
import { renderProducts } from './products/products.js';
import { renderProductForm } from './products/form.js';
import { renderRapidAdd } from './products/rapid.js';
import { renderCategories } from './products/categories.js';
import { renderCustomers, renderCustomer } from './customers/customers.js';
import { renderInvoices } from './invoices/history.js';
import { renderCash } from './cash/cash.js';
import { renderReports } from './reports/reports.js';
import { renderTools, renderImport, renderPrices, renderLabels } from './tools/tools.js';
import { renderInventory } from './inventory/hub.js';
import { renderPurchase } from './inventory/purchase.js';
import { renderSuppliers, renderSupplier } from './inventory/suppliers.js';
import { renderCount } from './inventory/count.js';
import { renderMore } from './more/more.js';
import { renderHelp } from './help/help.js';
import { renderSubscribe } from './subscribe/subscribe.js';
import {
  renderSettings, renderShopProfile, renderFeatures, renderCurrencies,
  renderPayments, renderSync, renderAppearance, renderAbout,
} from './settings/settings.js';

// write: true = شاشة كتابة (بيع، شراء، تعديل أصناف): في وضع القراءة فقط تُحوَّل إلى «الاشتراك».
export const MODULES = [
  { id: 'home', routes: [{ path: '/', tab: 'home', render: renderHome }] },
  {
    id: 'sale',
    routes: [
      { path: '/sale', write: true, chrome: false, render: renderSale },
      { path: '/sale/returns', write: true, chrome: false, render: renderReturns },
    ],
  },
  {
    id: 'products',
    routes: [
      { path: '/products', tab: 'products', render: renderProducts },
      { path: '/products/edit', write: true, tab: 'products', chrome: false, render: renderProductForm },
      { path: '/products/rapid', write: true, tab: 'products', chrome: false, render: renderRapidAdd },
      { path: '/settings/categories', tab: 'settings', chrome: false, render: renderCategories },
    ],
  },
  {
    id: 'customers',
    routes: [
      { path: '/customers', tab: 'customers', render: renderCustomers },
      { path: '/customers/view', tab: 'customers', chrome: false, render: renderCustomer },
    ],
  },
  {
    id: 'tools',
    routes: [
      { path: '/tools', tab: 'settings', chrome: false, render: renderTools },
      { path: '/tools/import', write: true, chrome: false, render: renderImport },
      { path: '/tools/prices', write: true, chrome: false, render: renderPrices },
      { path: '/tools/labels', chrome: false, render: renderLabels },
    ],
  },
  { id: 'reports', routes: [{ path: '/reports', tab: 'settings', chrome: false, render: renderReports }] },
  { id: 'cash', routes: [{ path: '/cash', tab: 'settings', chrome: false, render: renderCash }] },
  { id: 'invoices', routes: [{ path: '/invoices', tab: 'settings', chrome: false, render: renderInvoices }] },
  {
    id: 'inventory',
    routes: [
      { path: '/inventory', tab: 'settings', chrome: false, render: renderInventory },
      { path: '/inventory/purchase', write: true, chrome: false, render: renderPurchase },
      { path: '/inventory/count', write: true, chrome: false, render: renderCount },
      { path: '/suppliers', chrome: false, render: renderSuppliers },
      { path: '/suppliers/view', chrome: false, render: renderSupplier },
    ],
  },
  {
    id: 'settings',
    routes: [
      { path: '/more', tab: 'settings', render: renderMore },
      { path: '/help', tab: 'settings', chrome: false, render: renderHelp },
      { path: '/subscribe', tab: 'settings', chrome: false, render: renderSubscribe },
      { path: '/settings', tab: 'settings', chrome: false, render: renderSettings },
      { path: '/settings/shop', tab: 'settings', chrome: false, render: renderShopProfile },
      { path: '/settings/features', tab: 'settings', chrome: false, render: renderFeatures },
      { path: '/settings/currencies', tab: 'settings', chrome: false, render: renderCurrencies },
      { path: '/settings/payments', tab: 'settings', chrome: false, render: renderPayments },
      { path: '/settings/sync', tab: 'settings', chrome: false, render: renderSync },
      { path: '/settings/appearance', tab: 'settings', chrome: false, render: renderAppearance },
      { path: '/settings/about', tab: 'settings', chrome: false, render: renderAbout },
    ],
  },
];
