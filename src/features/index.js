// سجلّ الوحدات: كل وحدة تضيف شاشاتها هنا. وحدة جديدة = مجلد جديد + سطر هنا، دون لمس الوحدات الأخرى.
import { renderHome } from './home/home.js';
import { renderSale } from './sale/sale.js';
import { renderReturns } from './sale/returns.js';
import { renderProducts } from './products/products.js';
import { renderProductForm } from './products/form.js';
import { renderRapidAdd } from './products/rapid.js';
import { renderCategories } from './products/categories.js';
import { renderCustomers, renderCustomer } from './customers/customers.js';
import { renderRemind } from './customers/remind.js';
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
import { renderAccount, renderAccountRequired } from './account/account.js';
import { renderSmsSettings } from './settings/sms.js';
import { renderLock, renderStaff } from './staff/staff.js';
import { renderOffers } from './offers/offers.js';
import { renderScaleSettings } from './settings/scale.js';
import {
  renderSettings, renderShopProfile, renderFeatures, renderCurrencies,
  renderPayments, renderSync, renderAppearance, renderAbout,
} from './settings/settings.js';

// perm: صلاحية الموظف المطلوبة لفتح الشاشة (domain/staff.js)، و 'owner' لصاحب المحل وحده.
// write: true = شاشة كتابة (بيع، شراء، تعديل أصناف): في وضع القراءة فقط تُحوَّل إلى «الاشتراك».
export const MODULES = [
  { id: 'home', routes: [{ path: '/', tab: 'home', render: renderHome }] },
  {
    id: 'sale',
    routes: [
      { path: '/sale', write: true, chrome: false, render: renderSale },
      { path: '/sale/returns', perm: 'returns', write: true, chrome: false, render: renderReturns },
    ],
  },
  {
    id: 'products',
    routes: [
      { path: '/products', tab: 'products', render: renderProducts },
      { path: '/products/edit', perm: 'products', write: true, tab: 'products', chrome: false, render: renderProductForm },
      { path: '/products/rapid', perm: 'products', write: true, tab: 'products', chrome: false, render: renderRapidAdd },
      { path: '/offers', perm: 'products', tab: 'settings', chrome: false, render: renderOffers },
      { path: '/settings/categories', perm: 'products', tab: 'settings', chrome: false, render: renderCategories },
    ],
  },
  {
    id: 'customers',
    routes: [
      { path: '/customers', tab: 'customers', render: renderCustomers },
      { path: '/customers/view', tab: 'customers', chrome: false, render: renderCustomer },
      { path: '/customers/remind', tab: 'customers', chrome: false, render: renderRemind },
    ],
  },
  {
    id: 'tools',
    routes: [
      { path: '/tools', perm: 'products', tab: 'settings', chrome: false, render: renderTools },
      { path: '/tools/import', perm: 'products', write: true, chrome: false, render: renderImport },
      { path: '/tools/prices', perm: 'products', write: true, chrome: false, render: renderPrices },
      { path: '/tools/labels', perm: 'products', chrome: false, render: renderLabels },
    ],
  },
  { id: 'reports', routes: [{ path: '/reports', perm: 'reports', tab: 'settings', chrome: false, render: renderReports }] },
  { id: 'cash', routes: [{ path: '/cash', perm: 'cash', tab: 'settings', chrome: false, render: renderCash }] },
  { id: 'invoices', routes: [{ path: '/invoices', tab: 'settings', chrome: false, render: renderInvoices }] },
  {
    id: 'inventory',
    routes: [
      { path: '/inventory', perm: 'purchases', tab: 'settings', chrome: false, render: renderInventory },
      { path: '/inventory/purchase', perm: 'purchases', write: true, chrome: false, render: renderPurchase },
      { path: '/inventory/count', perm: 'purchases', write: true, chrome: false, render: renderCount },
      { path: '/suppliers', perm: 'purchases', chrome: false, render: renderSuppliers },
      { path: '/suppliers/view', perm: 'purchases', chrome: false, render: renderSupplier },
    ],
  },
  {
    id: 'settings',
    routes: [
      { path: '/more', tab: 'settings', render: renderMore },
      { path: '/help', tab: 'settings', chrome: false, render: renderHelp },
      { path: '/subscribe', tab: 'settings', chrome: false, render: renderSubscribe },
      { path: '/account', perm: 'settings', tab: 'settings', chrome: false, render: renderAccount },
      { path: '/account/required', chrome: false, render: renderAccountRequired },
      { path: '/lock', chrome: false, render: renderLock },
      { path: '/settings/staff', perm: 'owner', tab: 'settings', chrome: false, render: renderStaff },
      { path: '/settings/sms', perm: 'settings', tab: 'settings', chrome: false, render: renderSmsSettings },
      { path: '/settings/scale', perm: 'settings', tab: 'settings', chrome: false, render: renderScaleSettings },
      { path: '/settings', perm: 'settings', tab: 'settings', chrome: false, render: renderSettings },
      { path: '/settings/shop', perm: 'settings', tab: 'settings', chrome: false, render: renderShopProfile },
      { path: '/settings/features', perm: 'settings', tab: 'settings', chrome: false, render: renderFeatures },
      { path: '/settings/currencies', perm: 'settings', tab: 'settings', chrome: false, render: renderCurrencies },
      { path: '/settings/payments', perm: 'settings', tab: 'settings', chrome: false, render: renderPayments },
      { path: '/settings/sync', perm: 'settings', tab: 'settings', chrome: false, render: renderSync },
      { path: '/settings/appearance', perm: 'settings', tab: 'settings', chrome: false, render: renderAppearance },
      { path: '/settings/about', tab: 'settings', chrome: false, render: renderAbout },
    ],
  },
];
