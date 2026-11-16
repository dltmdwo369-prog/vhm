"""Offline design and UI smoke tests. No Google account, network, real data or test server.

Run: python3 tests/visual-smoke.py  (requires Python playwright and Chromium)
Override browser path with VHM_CHROMIUM if needed.
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / 'site/index.html').read_text(encoding='utf-8').replace(
    '<script src="config.js"></script>',
    '<script>window.VHM_CONFIG = { clientId: "" };</script>'
)
assert 'window.VHM_CONFIG = { clientId: "" }' in HTML
assert '현장의 하루를 더 가볍게' not in HTML
assert '일정은 명확하게' not in HTML

EVENTS = [
    { 'id':'mock-a', 'date':'2026-11-13','kind':'work', 'type':'방문', 'target':'가상 A', 'status':'예정', 'start':'09:30', 'fromApp':True },
    { 'id':'mock-b', 'date':'2026-11-14','kind':'work', 'type':'전화', 'target':'가상 B', 'status':'예정', 'start':'10:00', 'fromApp':True },
    { 'id':'mock-c', 'date':'2026-11-15','kind':'work', 'type':'연계', 'target':'가상 C', 'status':'완료', 'start':'11:00', 'fromApp':True },
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('VHM_CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'])
    for width, height in [(1440, 900), (768, 1024), (390, 844), (320, 740)]:
        page = browser.new_page(viewport={'width':width,'height':height})
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda req: requests.append(req.url))
        page.set_content(HTML, wait_until='domcontentloaded')
        page.evaluate('''(events) => {
            S.events = events;
            S.doneEvents = [];
            S.loadedAt = Date.now();
            S.dues = [];
            S.cursor = new Date(2026, 10, 1);
            S.selected = '2026-11-13';
            S.settings = Object.assign({}, S.settings || {}, {show:'all',view:'month'});
            render();
        }''', EVENTS)
        assert page.locator('#ovTotal').inner_text() == '3'
        assert page.locator('#ovPending').inner_text() == '2'
        assert page.locator('#ovDone').inner_text() == '1'
        assert page.locator('#monthView .day').count() >= 28
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth') is True, f'horizontal overflow at {width}px'
        page.locator('#viewSeg button[data-v="list"]').click()
        assert page.locator('#listView .item').count() == 3
        page.locator('#viewSeg button[data-v="month"]').click()
        page.locator('[data-tab="edu"]').click()
        assert page.locator('#tab-edu .edu-card').count() >= 5
        page.locator('[data-tab="cal"]').click()
        assert page.locator('#tab-cal').is_visible()
        page.locator('[data-tab="note"]').click()
        assert page.locator('#tab-note').is_visible()
        page.locator('[data-tab="cal"]').click()
        # New memo template is editable; existing/locked notes must never be replaced.
        template = '특이사항:\n이름/생년월일:\n주소:\n전화번호:'
        page.evaluate('openEvent(null)')
        memo = page.locator('#eventForm textarea[name="memo"]')
        assert memo.input_value() == template
        assert page.evaluate('readForm().memo') == ''
        assert memo.evaluate('el => { const s = getComputedStyle(el); return el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) >= 5 * parseFloat(s.lineHeight); }')
        assert page.evaluate('document.querySelector("#eventDlg").scrollWidth <= document.querySelector("#eventDlg").clientWidth'), f'memo dialog overflow at {width}px'
        memo.fill(template.replace('특이사항:', '특이사항: 가상 테스트'))
        assert page.evaluate('readForm().memo') == template.replace('특이사항:', '특이사항: 가상 테스트')
        memo.fill('')
        assert page.evaluate('readForm().memo') == ''
        page.evaluate('document.querySelector("#eventDlg").close(); openEvent(null, {memo:"연계 일정 가상 메모"})')
        assert memo.input_value() == '연계 일정 가상 메모'
        for existing in [dict(EVENTS[0], memo='기존 가상 메모'), dict(EVENTS[0], memo='')]:
            page.evaluate('ev => { document.querySelector("#eventDlg").close(); openEvent(ev); }', existing)
            assert memo.input_value() == existing['memo']
        page.evaluate('ev => { document.querySelector("#eventDlg").close(); openEvent(ev); }', dict(EVENTS[0], memo='', memoLock='locked', memoCipher='fake-cipher'))
        assert memo.is_disabled() and memo.input_value() == ''
        assert page.evaluate('readForm().memoCipher') == 'fake-cipher'
        page.evaluate('document.querySelector("#eventDlg").close()')
        for ptype in ['일정', '메모']:
            page.evaluate('ptype => openEvent(null, {kind:"personal", ptype})', ptype)
            assert memo.input_value() == ''
            assert not page.locator('#eventEndDate').is_visible()
            page.locator('#eventForm input[name="title"]').fill('가상 개인 테스트')
            assert page.evaluate('readForm().endDate') == ''
            page.locator('#eventForm label:has(input[name="dateMode"][value="range"])').click()
            assert page.locator('#eventEndDate').is_visible()
            assert page.locator('#eventDateLabel').inner_text() == '시작하는 날'
            page.locator('#eventForm input[name="endDate"]').fill('2026-11-15')
            assert page.evaluate('readForm().endDate') == '2026-11-15'
            assert page.evaluate('document.querySelector("#eventDlg").scrollWidth <= document.querySelector("#eventDlg").clientWidth'), f'personal range overflow at {width}px'
            page.locator('#eventForm label:has(input[name="dateMode"][value="single"])').click()
            assert page.evaluate('readForm().endDate') == ''
            assert not page.locator('#eventEndDate').is_visible()
            page.evaluate('document.querySelector("#eventDlg").close()')
        page.evaluate('openEvent(null)')
        memo.fill('가상 입력 중 메모')
        page.locator('#eventForm label:has(input[name="kind"][value="personal"])').click()
        assert memo.input_value() == '가상 입력 중 메모'
        page.evaluate('document.querySelector("#eventDlg").close()')
        # Sign out must clear cached UI data as well as the aggregate cards.
        page.evaluate('(events) => { S.doneEvents = events; S.dues = [{id:"mock-due"}]; }', EVENTS)
        page.on('dialog', lambda dialog: dialog.accept())
        page.locator('[data-tab="set"]').click()
        page.locator('#btnSignOut').click()
        assert page.evaluate('S.events.length === 0 && S.doneEvents.length === 0 && S.dues.length === 0 && S.loadedAt === 0')
        for selector in ['#ovTotal', '#ovPending', '#ovDone']:
            assert page.locator(selector).inner_text() == '—'
        assert not errors, f'JS errors {errors}'
        assert not requests, f'Unexpected network request: {requests}'
        print(f'PASS {width}x{height}: editable five-line memo template, existing/locked memos, overview, calendar, list, education, notes, responsiveness, no network/JS errors')
        page.close()
    browser.close()
