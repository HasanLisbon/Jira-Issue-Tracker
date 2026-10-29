import React from 'react';
import { X, User, Mail, Shield, CheckCircle2, Clock, Award, ExternalLink } from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-sm bg-[#232630] border border-[#2E3240] rounded-lg shadow-2xl overflow-hidden text-[#E1E4EA]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#1C1E26] border-b border-[#2B2E3C]">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-semibold text-[#FFFFFF]">User Profile</span>
            <span className="text-[10px] font-mono text-[#5384F7] bg-[#1E2945] px-1.5 py-0.2 rounded border border-[#5384F7]/30">
              JIRA ACCOUNT
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#7D8395] hover:text-[#E1E4EA] hover:bg-[#2E3240] rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-[11.5px]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#3B68FF] text-white flex items-center justify-center font-bold text-base shadow-md">
              SC
            </div>
            <div>
              <div className="text-[13.5px] font-semibold text-white">Simul City College</div>
              <div className="text-[#7D8395] text-[11px] font-mono">simul.citycollege@gmail.com</div>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#34C759]">
                <CheckCircle2 className="w-3 h-3" />
                <span>Authorized via OAuth2 Token</span>
              </div>
            </div>
          </div>

          <div className="bg-[#181A20] p-3 rounded border border-[#2E3240] space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#7D8395]">Jira Organization:</span>
              <span className="font-mono text-[#E1E4EA]">CGM AG Healthcare</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#7D8395]">Assigned Sprint:</span>
              <span className="font-mono text-[#5384F7]">Sprint 42 (Active)</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#7D8395]">Today's Time Logged:</span>
              <span className="font-mono text-[#34C759] font-semibold">4h 45m</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#7D8395]">Permission Tier:</span>
              <span className="text-[#C5CAD4]">Project Contributor & Time Reporter</span>
            </div>
          </div>

          <div className="pt-1 flex items-center justify-between">
            <a
              href="https://jira.cgm.ag"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-[#5384F7] hover:underline flex items-center gap-1"
            >
              <span>Open in Atlassian Web</span>
              <ExternalLink className="w-3 h-3" />
            </a>

            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded bg-[#2E3240] hover:bg-[#383C4D] text-[11.5px] text-white transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
