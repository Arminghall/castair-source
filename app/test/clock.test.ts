/*
 * Tests for the standby clock helpers.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {deviceCountry, deviceTimeZone, formatDate, formatTime, offsetAt} from '../src/standby/clock';

const time = {
  timeZone: 'Europe/London',
  utcOffsetMinutes: 0,
  next: {at: '2027-03-28T01:00:00.000Z', utcOffsetMinutes: 60},
};

describe('offsetAt', () => {
  it('uses the server offset', () => {
    expect(offsetAt(Date.parse('2027-03-01T12:00:00Z'), time)).toBe(0);
  });
  it('switches offset at the next change', () => {
    expect(offsetAt(Date.parse('2027-03-28T01:00:00Z'), time)).toBe(60);
    expect(offsetAt(Date.parse('2027-04-01T12:00:00Z'), time)).toBe(60);
  });
  it('null time gives 0', () => {
    expect(offsetAt(Date.now(), null)).toBe(0);
  });
  it('copes with no next change', () => {
    expect(offsetAt(Date.now(), {...time, next: null})).toBe(0);
  });
});

function mockIntl(resolved: Record<string, string> | 'throw') {
  jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((() => {
    if (resolved === 'throw') {
      throw new Error('no Intl');
    }
    return {resolvedOptions: () => resolved};
  }) as never);
}

describe('device settings', () => {
  afterEach(() => jest.restoreAllMocks());

  it('deviceTimeZone returns the zone', () => {
    mockIntl({timeZone: 'Europe/London', locale: 'en-GB'});
    expect(deviceTimeZone()).toBe('Europe/London');
  });
  it.each(['UTC', 'Etc/UTC', 'Etc/GMT+1', 'GMT', 'Universal'])('deviceTimeZone is null for %s', (zone) => {
    mockIntl({timeZone: zone, locale: 'en-GB'});
    expect(deviceTimeZone()).toBeNull();
  });
  it('deviceTimeZone and deviceCountry are null on error', () => {
    mockIntl('throw');
    expect(deviceTimeZone()).toBeNull();
    expect(deviceCountry()).toBeNull();
  });
  it('deviceCountry reads the locale region', () => {
    mockIntl({timeZone: 'Europe/London', locale: 'en-GB'});
    expect(deviceCountry()).toBe('GB');
  });
  it('deviceCountry is null without a region', () => {
    mockIntl({timeZone: 'Europe/London', locale: 'en'});
    expect(deviceCountry()).toBeNull();
  });
});

describe('formatTime', () => {
  const at = Date.parse('2026-11-20T14:32:00Z');
  it('24-hour', () => expect(formatTime(at, 0, false)).toBe('14:32'));
  it('12-hour', () => expect(formatTime(at, 0, true)).toBe('2:32 PM'));
  it('12:05 AM at 00:05', () => expect(formatTime(Date.parse('2026-11-20T00:05:00Z'), 0, true)).toBe('12:05 AM'));
  it('applies the offset', () => expect(formatTime(at, 60, false)).toBe('15:32'));
});

describe('formatDate', () => {
  const noon = Date.parse('2026-11-20T12:00:00Z');
  it('GB style', () => expect(formatDate(noon, 0, 'GB')).toBe('Friday 20 November'));
  it('null country uses GB style', () => expect(formatDate(noon, 0, null)).toBe('Friday 20 November'));
  it('US style', () => expect(formatDate(noon, 0, 'US')).toBe('Friday, November 20'));
  it('rolls over with the offset', () => {
    expect(formatDate(Date.parse('2026-11-20T23:30:00Z'), 60, 'GB')).toBe('Saturday 21 November');
  });
});
