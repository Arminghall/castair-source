/*
 * Jest manual mock of Amazon's in-app purchasing library (a Vega system
 * bundle with no Jest implementation). The enums carry the library's values
 * (dist/types/IAPTypes.d.ts, 2.13.0). By default Amazon answers with no
 * receipts, no products and a failed purchase; tests override per call.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export enum ProductType {
  CONSUMABLE = 1,
  ENTITLED = 2,
  SUBSCRIPTION = 3,
}

export enum FulfillmentResult {
  FULFILLED = 1,
  UNAVAILABLE = 2,
}

export enum PurchaseResponseCode {
  SUCCESSFUL = 0,
  ALREADY_PURCHASED = 1,
  INVALID_SKU = 2,
  NOT_SUPPORTED = 3,
  FAILED = 4,
}

export enum PurchaseUpdatesResponseCode {
  SUCCESSFUL = 1,
  NOT_SUPPORTED = 2,
  FAILED = 3,
}

export enum ProductDataResponseCode {
  SUCCESSFUL = 1,
  NOT_SUPPORTED = 2,
  FAILED = 3,
}

export enum NotifyFulfillmentResponseCode {
  SUCCESSFUL = 1,
  NOT_SUPPORTED = 2,
  FAILED = 3,
}

export const PurchasingService = {
  getPurchaseUpdates: jest.fn(() =>
    Promise.resolve({responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL, receiptList: [], hasMore: false}),
  ),
  getProductData: jest.fn(() =>
    Promise.resolve({responseCode: ProductDataResponseCode.SUCCESSFUL, productData: new Map(), unavailableSkus: []}),
  ),
  purchase: jest.fn(() => Promise.resolve({responseCode: PurchaseResponseCode.FAILED, receipt: null})),
  notifyFulfillment: jest.fn(() => Promise.resolve({responseCode: NotifyFulfillmentResponseCode.SUCCESSFUL})),
  getUserData: jest.fn(() => Promise.resolve({responseCode: 1, userData: null})),
};
