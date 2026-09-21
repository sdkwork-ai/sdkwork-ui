import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Dialog,
  DialogContent,
} from './dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from './select';

afterEach(() => {
  document.body.style.pointerEvents = '';
  cleanup();
});

/**
 * A real mouse click opens the Radix panel on pointerdown, so the remaining
 * events of the same interaction (pointerup/mousedown/mouseup/click) still
 * target the trigger. Regression: the outside-interaction guard once treated
 * those opening-sequence events as outside clicks and dismissed the panel
 * immediately after it opened.
 *
 * Note: native PointerEvent dispatch is required here — testing-library's
 * fireEvent.pointerDown creates events without a pointerType in jsdom, which
 * never exercises Radix's mouse-pointerdown opening path. The panel commit is
 * awaited after pointerdown to mirror the browser, where the remaining events
 * of the click reach the trigger after the freshly opened panel is mounted.
 */
async function openWithMouseClick(trigger: HTMLElement) {
  const pointerDown = new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
  });
  trigger.dispatchEvent(pointerDown);
  await screen.findByRole('listbox');
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.mouseDown(trigger);
  fireEvent.mouseUp(trigger);
  fireEvent.click(trigger);
}

/**
 * The same opening gesture as a real browser actually delivers it.
 *
 * Radix's `SelectTrigger.onPointerDown` calls `event.preventDefault()` after
 * opening the panel. Per the DOM spec that suppresses the compatibility mouse
 * events and makes the browser retarget the trailing `pointerup`/`click` to the
 * nearest common ancestor — in practice `<html>`, never the trigger. A guard
 * that recognised the opening sequence only by "is the target inside the open
 * trigger" therefore classified the opening click as an outside interaction and
 * dismissed the panel in the same tick it opened: the page-size dropdown in the
 * DataTable footer closed before a value could be picked.
 *
 * Dispatch the retargeted sequence at `document.documentElement` to reproduce
 * that, with the guard's own timer window not yet elapsed.
 */
async function openWithRetargetedMouseClick(trigger: HTMLElement) {
  const pointerDown = new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
  });
  trigger.dispatchEvent(pointerDown);
  await screen.findByRole('listbox');
  // What the browser sends when pointerdown was preventDefault()ed: the trailing
  // events land on <html> and no mousedown/mouseup is emitted at all.
  fireEvent.pointerUp(document.documentElement, { button: 0, pointerId: 1, pointerType: 'mouse' });
  fireEvent.click(document.documentElement, { button: 0 });
}

describe('SelectContent', () => {
  it('keeps the options panel open after the mouse interaction that opened it', async () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger>Pick</SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    await openWithMouseClick(trigger);
    await screen.findByRole('listbox');

    expect(screen.getByText('Option A')).toBeTruthy();
    expect(screen.getByText('Option B')).toBeTruthy();
  });

  it('keeps the options panel open beyond the guard dismiss window after opening', async () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger>Pick</SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    await openWithMouseClick(trigger);
    expect(screen.queryByRole('listbox')).toBeTruthy();

    // The outside-interaction guard schedules a 200ms dismiss for non-click
    // events that are not exempted; wait past that window and confirm the
    // panel survives (regression: dist builds once dropped the open-trigger
    // exemption and dismissed freshly opened panels).
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByRole('listbox')).toBeTruthy();
  });

  it('keeps the options panel open when the opening click is retargeted to the document', async () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger>Pick</SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    await openWithRetargetedMouseClick(trigger);
    expect(screen.queryByRole('listbox')).toBeTruthy();

    // The panel must outlive the guard's dismiss window; a regression here is
    // the DataTable page-size dropdown closing the instant it opened.
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.queryByRole('listbox')).toBeTruthy();
  });

  it('dismisses on an outside click that happens after the opening gesture', async () => {
    const selectOpenChange = vi.fn();
    render(
      <Select defaultValue="a" onOpenChange={selectOpenChange}>
        <SelectTrigger>Pick</SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    await openWithRetargetedMouseClick(trigger);
    expect(selectOpenChange).toHaveBeenLastCalledWith(true);

    // Past the opening-sequence window, an interaction outside the panel is a
    // genuine outside click and must still dismiss — the guard exists to keep a
    // hosting Modal/Drawer open while the select closes.
    await new Promise((resolve) => setTimeout(resolve, 800));
    const outsideTarget = document.body.appendChild(document.createElement('div'));
    fireEvent.pointerDown(outsideTarget, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(outsideTarget, { button: 0, pointerType: 'mouse' });
    fireEvent.click(outsideTarget);
    document.body.removeChild(outsideTarget);

    await waitFor(() => expect(selectOpenChange).toHaveBeenLastCalledWith(false));
  });

  it('still dismisses the select but keeps the host dialog open on outside clicks', async () => {
    const dialogOpenChange = vi.fn();
    const selectOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={dialogOpenChange}>
        <DialogContent>
          <Select defaultValue="a" onOpenChange={selectOpenChange}>
            <SelectTrigger>Pick</SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
            </SelectContent>
          </Select>
        </DialogContent>
      </Dialog>,
    );

    const trigger = screen.getByRole('combobox');
    await openWithMouseClick(trigger);
    await screen.findByRole('listbox');
    expect(selectOpenChange).toHaveBeenLastCalledWith(true);

    // Clicking outside the options panel (e.g. on the dialog backdrop) must
    // dismiss the select while keeping the hosting dialog open.
    const outsideTarget = document.body.appendChild(document.createElement('div'));
    fireEvent.pointerDown(outsideTarget, { button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(outsideTarget, { button: 0, pointerType: 'mouse' });
    fireEvent.click(outsideTarget);
    document.body.removeChild(outsideTarget);

    await waitFor(() => expect(selectOpenChange).toHaveBeenLastCalledWith(false));
    expect(dialogOpenChange).not.toHaveBeenCalledWith(false);
  });
});
