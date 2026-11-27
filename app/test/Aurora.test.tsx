/*
 * CastAir's aurora: the menu backdrop and its credit.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {StyleSheet} from 'react-native';
import {render, screen} from '@testing-library/react-native';
import {AURORA, AURORA_CREDIT, Backdrop} from '../src/Aurora';
import {AboutTab} from '../src/AboutTab';

it('the backdrop is the aurora under a dark tint', () => {
  render(<Backdrop />);
  expect(screen.getByTestId('backdrop').props.source).toBe(AURORA);
  expect(StyleSheet.flatten(screen.getByTestId('backdrop-tint').props.style).backgroundColor).toBe('rgba(0,0,0,.42)');
});

it('the aurora is credited to its photographer, and About says so', () => {
  expect(AURORA_CREDIT).toBe('Photo by Kush Dwivedi on Unsplash');
  render(<AboutTab />);
  expect(screen.getByText(`Background: ${AURORA_CREDIT}`)).toBeTruthy();
});
