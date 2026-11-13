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
import { renderInventory } from './inventory/hub.js';
import { renderPurchase } from './inventory/purchase.js';
import { renderSuppliers, renderSupplier } from './inventory/suppliers.js';
import { renderCount } from './inventory/count.js';
import {
  renderSettings, renderShopProfile, renderFeatures, renderCurrencies,
  renderPayments, renderSync, renderAppearance, renderAbout,
} from './settings/settings.js';

export const MODULES = [
  { id: 'home', routes: [{ path: '/', tab: 'home', render: renderHome }] },
  {
    id: 'sale',
    routes: [
      { path: '/sale', chrome: false, render: renderSale },
      { path: '/sale/returns', chrome: false, render: renderReturns },
    ],
  },
  {
    id: 'products',
    routes: [
      { path: '/products', tab: 'products', render: renderProducts },
      { path: '/products/edit', tab: 'products', chrome: false, render: renderProductForm },
      { path: '/products/rapid', tab: 'products', chrome: false, render: renderRapidAdd },
      { path: '/settings/categories', tab: 'settings', render: renderCategories },
    ],
  },
  {
    id: 'customers',
    routes: [
      { path: '/customers', tab: 'customers', render: renderCustomers },
      { path: '/customers/view', tab: 'customers', chrome: false, render: renderCustomer },
    ],
  },
  { id: 'reports', routes: [{ path: '/reports', tab: 'settings', chrome: false, render: renderReports }] },
  { id: 'cash', routes: [{ path: '/cash', tab: 'settings', chrome: false, render: renderCash }] },
  { id: 'invoices', routes: [{ path: '/invoices', tab: 'settings', chrome: false, render: renderInvoices }] },
  {
    id: 'inventory',
    routes: [
      { path: '/inventory', tab: 'settings', chrome: false, render: renderInventory },
      { path: '/inventory/purchase', chrome: false, render: renderPurchase },
      { path: '/inventory/count', chrome: false, render: renderCount },
      { path: '/suppliers', chrome: false, render: renderSuppliers },
      { path: '/suppliers/view', chrome: false, render: renderSupplier },
    ],
  },
  {
    id: 'settings',
    routes: [
      { path: '/settings', tab: 'settings', render: renderSettings },
      { path: '/settings/shop', tab: 'settings', render: renderShopProfile },
      { path: '/settings/features', tab: 'settings', render: renderFeatures },
      { path: '/settings/currencies', tab: 'settings', render: renderCurrencies },
      { path: '/settings/payments', tab: 'settings', render: renderPayments },
      { path: '/settings/sync', tab: 'settings', render: renderSync },
      { path: '/settings/appearance', tab: 'settings', render: renderAppearance },
      { path: '/settings/about', tab: 'settings', render: renderAbout },
    ],
  },
];
