import React, { useEffect, useRef, useState } from 'react';
import type { BranchPlan } from './branches.ts';
import { messages } from './messages.ts';

interface BranchDialogProps {
  plan: BranchPlan;
  busy: boolean;
  error: string;
  onConfirm: (root: string, name: string, base: string) => void;
  onTimerOnly: () => void;
  onCancel: () => void;
}

export function BranchDialog({ plan, busy, error, onConfirm, onTimerOnly, onCancel }: BranchDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(plan.suggestedName);
  const [root, setRoot] = useState(plan.repositories.length === 1 ? plan.repositories[0].id : '');
  const [base, setBase] = useState('HEAD');
  const repository = plan.repositories.find((candidate) => candidate.id === root);
  const [type, setType] = useState(plan.suggestedName.startsWith('bugfix/') ? 'bugfix' : 'feature');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} aria-labelledby="branch-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}
      className="m-auto w-[calc(100%-24px)] max-w-md max-h-[90vh] overflow-y-auto rounded-lg border border-[#2E3240] bg-[#232630] p-4 text-[#E1E4EA] backdrop:bg-black/60">
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && root && base && name.trim()) onConfirm(root, name, base); }} className="space-y-3">
        <h2 id="branch-dialog-title" className="text-sm font-semibold">{messages['branch.title']}</h2>
        <p className="font-mono text-[#5384F7]">{plan.key}</p>
        {error && <p role="alert" className="text-[#FF5C5C]">{error}</p>}
        {!plan.repositories.length ? <p>{messages['branch.no.repository']}</p> : <>
          <label className="block">{messages['branch.repository']}
            <select required value={root} disabled={busy} onChange={(event) => { setRoot(event.target.value); setBase('HEAD'); }}
              className="mt-1 w-full rounded border border-[#2E3240] bg-[#181A20] p-2">
              <option value="">{messages['branch.repository.select']}</option>
              {plan.repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.id} ({repository.base})</option>)}
            </select>
          </label>
          <label className="block">{messages['branch.base.label']}
            <select aria-label={messages['branch.base.label']} required value={base} disabled={busy || !root}
              onChange={(event) => setBase(event.target.value)}
              className="mt-1 w-full rounded border border-[#2E3240] bg-[#181A20] p-2 font-mono">
              <option value="HEAD">{messages['branch.base.head']}{repository ? ` (${repository.base})` : ''}</option>
              <optgroup label={messages['branch.base.local']}>
                {repository?.branches.filter((branch) => branch.startsWith('refs/heads/')).map((branch) =>
                  <option key={branch} value={branch}>{branch.slice('refs/heads/'.length)}</option>)}
              </optgroup>
              <optgroup label={messages['branch.base.remote']}>
                {repository?.branches.filter((branch) => branch.startsWith('refs/remotes/')).map((branch) =>
                  <option key={branch} value={branch}>{branch.slice('refs/remotes/'.length)}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="block">{messages['branch.type']}
            <select aria-label={messages['branch.type']} value={type} disabled={busy} onChange={(event) => {
              setType(event.target.value);
              setName((previous) => `${event.target.value}/${previous.replace(/^[^/]+\//, '')}`);
            }} className="mt-1 w-full rounded border border-[#2E3240] bg-[#181A20] p-2">
              <option value="feature">{messages['branch.feature']}</option>
              <option value="bugfix">{messages['branch.bugfix']}</option>
            </select>
          </label>
          <label className="block">{messages['branch.name']}
            <input autoFocus required value={name} disabled={busy} onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded border border-[#2E3240] bg-[#181A20] p-2 font-mono" />
          </label>
          <p className="text-[#7D8395]">{messages['branch.base']}</p>
        </>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded border border-[#2E3240] px-3 py-2 disabled:opacity-40">{messages.cancel}</button>
          <button type="button" disabled={busy} onClick={onTimerOnly} className="rounded border border-[#2E3240] px-3 py-2 disabled:opacity-40">{messages['branch.timer.only']}</button>
          {!!plan.repositories.length && <button disabled={busy || !root || !base || !name.trim()} className="rounded bg-[#3B68FF] px-3 py-2 disabled:opacity-40">{messages[busy ? 'branch.creating' : 'branch.create']}</button>}
        </div>
      </form>
    </dialog>
  );
}
