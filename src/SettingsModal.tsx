import React from 'react';
import { X, Server } from 'lucide-react';
import { messages } from './messages.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigure: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onConfigure }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label={messages.settings} className="w-full max-w-md bg-[#232630] border border-[#2E3240] rounded-lg shadow-2xl text-[#E1E4EA]">
        <div className="flex items-center justify-between px-4 py-3 bg-[#1C1E26]">
          <span className="font-semibold">{messages.settings}</span>
          <button onClick={onClose} aria-label={messages.cancel}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <p>{messages['connection.required']}</p>
          <button onClick={() => { void onConfigure(); }} className="flex items-center gap-2 px-3 py-2 rounded bg-[#3B68FF] text-white"><Server className="w-4 h-4" />{messages.settings}</button>
          <button onClick={onClose} className="px-3 py-2 rounded border border-[#2E3240]">{messages.refresh}</button>
        </div>
      </div>
    </div>
  );
};
