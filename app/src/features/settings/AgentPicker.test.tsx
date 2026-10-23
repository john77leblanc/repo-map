import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentPicker, validModel } from '../../shared/ui/AgentPicker';
const agents = [
    {
        id: 'codex',
        label: 'Codex CLI',
        available: true,
        defaultModel: 'default',
        models: [],
        efforts: ['low'],
    },
    {
        id: 'missing',
        label: 'Missing',
        available: false,
        reason: 'Not installed',
        defaultModel: '',
        models: [],
        efforts: [],
    },
];
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});
describe('AgentPicker', () => {
    it('rejects unsafe models and debounces a valid custom selection', async () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        render(
            <AgentPicker
                prefix="mpick"
                agents={agents}
                value={null}
                inheritLabel="Same as traces"
                onChange={onChange}
                onRefresh={vi.fn()}
            />
        );
        fireEvent.change(screen.getByLabelText('AI tool and model'), {
            target: { value: JSON.stringify(['codex', '*']) },
        });
        const input = screen.getByLabelText('Model id for the map');
        fireEvent.change(input, { target: { value: '-unsafe' } });
        await vi.advanceTimersByTimeAsync(600);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(input, { target: { value: 'gpt-6.1-sol' } });
        await vi.advanceTimersByTimeAsync(500);
        expect(onChange).toHaveBeenCalledWith({ agent: 'codex', model: 'gpt-6.1-sol', effort: '' });
        expect(validModel('bad model')).toBe(false);
    });
    it('offers inheritance and unavailable reasons and refreshes the shared list', () => {
        const refresh = vi.fn();
        render(
            <AgentPicker
                prefix="mpick"
                agents={agents}
                value={null}
                inheritLabel="Same as traces"
                onChange={vi.fn()}
                onRefresh={refresh}
            />
        );
        expect(screen.getByRole('option', { name: 'Not installed' }).hasAttribute('disabled')).toBe(
            true
        );
        fireEvent.click(screen.getByRole('button', { name: 'Look for AI tools and models again' }));
        expect(refresh).toHaveBeenCalledOnce();
    });
});
