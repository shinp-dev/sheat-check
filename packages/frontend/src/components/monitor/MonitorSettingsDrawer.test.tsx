// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorSettingsDrawer } from './MonitorSettingsDrawer';

describe('MonitorSettingsDrawer QR access', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the student QR and copies the URL without showing a long link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<MonitorSettingsDrawer roomId="example-room" />);
    const url = window.location.origin + '/student/example-room';
    expect(screen.getByAltText('学生用チェックインQRコード')).toHaveAttribute(
      'src', expect.stringContaining(encodeURIComponent(url)),
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(url)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /チェックインURLをコピー/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    expect(screen.getByRole('status')).toHaveTextContent('コピーしました');
  });

  it('renders nothing without a selected classroom', () => {
    const { container } = render(<MonitorSettingsDrawer roomId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
