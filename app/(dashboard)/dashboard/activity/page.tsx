import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Settings,
  LogOut,
  UserPlus,
  Lock,
  UserCog,
  AlertCircle,
  UserMinus,
  Mail,
  CheckCircle,
  Palette,
  Clapperboard,
  Image,
  Package,
  PanelsTopLeft,
  CircleCheck,
  RotateCcw,
  Video,
  CircleX,
  ClipboardCheck,
  Download,
  Link2,
  FileOutput,
  type LucideIcon,
} from 'lucide-react';
import { ActivityType } from '@/lib/db/schema';
import { getActivityLogs } from '@/lib/db/queries';

const iconMap: Record<ActivityType, LucideIcon> = {
  [ActivityType.SIGN_UP]: UserPlus,
  [ActivityType.SIGN_IN]: UserCog,
  [ActivityType.SIGN_OUT]: LogOut,
  [ActivityType.UPDATE_PASSWORD]: Lock,
  [ActivityType.DELETE_ACCOUNT]: UserMinus,
  [ActivityType.UPDATE_ACCOUNT]: Settings,
  [ActivityType.CREATE_TEAM]: UserPlus,
  [ActivityType.REMOVE_TEAM_MEMBER]: UserMinus,
  [ActivityType.INVITE_TEAM_MEMBER]: Mail,
  [ActivityType.ACCEPT_INVITATION]: CheckCircle,
  [ActivityType.CREATE_BRAND_KIT]: Palette,
  [ActivityType.UPDATE_BRAND_KIT]: Palette,
  [ActivityType.UPLOAD_PRODUCT_ASSET]: Image,
  [ActivityType.CREATE_CAMPAIGN]: Clapperboard,
  [ActivityType.SELECT_SHOT_CARD]: PanelsTopLeft,
  [ActivityType.SUBMIT_VIDEO_JOB]: Video,
  [ActivityType.VIDEO_JOB_SUCCEEDED]: CircleCheck,
  [ActivityType.VIDEO_JOB_FAILED]: AlertCircle,
  [ActivityType.RETRY_VIDEO_JOB]: RotateCcw,
  [ActivityType.ADOPT_VIDEO]: ClipboardCheck,
  [ActivityType.REJECT_VIDEO]: CircleX,
  [ActivityType.IMPORT_CSV]: Download,
  [ActivityType.COMMIT_CSV_IMPORT]: CheckCircle,
  [ActivityType.CREATE_CATALOG_ITEM]: Package,
  [ActivityType.UPDATE_CATALOG_ITEM]: Package,
  [ActivityType.COPY_CATALOG_ITEM]: Package,
  [ActivityType.APPROVE_CREATIVE_SPEC]: ClipboardCheck,
  [ActivityType.CREATE_PRODUCTION_BATCH]: Clapperboard,
  [ActivityType.UPDATE_PRODUCTION_BATCH_PROMPT]: Settings,
  [ActivityType.ESTIMATE_BATCH_COST]: Settings,
  [ActivityType.CONFIRM_BATCH_COST]: CheckCircle,
  [ActivityType.SELECT_BATCH_PILOTS]: PanelsTopLeft,
  [ActivityType.SCHEDULE_BATCH_WAVE]: Video,
  [ActivityType.PAUSE_PRODUCTION_BATCH]: AlertCircle,
  [ActivityType.CANCEL_PRODUCTION_BATCH]: CircleX,
  [ActivityType.BIND_PRODUCTION_BATCH_SPEC]: Link2,
  [ActivityType.COMPLETE_PRODUCTION_BATCH]: CheckCircle,
  [ActivityType.RELEASE_BULK_PILOT]: CheckCircle,
  [ActivityType.RESUME_PRODUCTION_BATCH]: RotateCcw,
  [ActivityType.EXPORT_PRODUCTION_BATCH]: FileOutput,
  [ActivityType.EXPORT_ADOPTED_VIDEO]: Download,
  [ActivityType.QUALITY_GATE_RECORDED]: CheckCircle,
  [ActivityType.CREATE_REMEDIATION]: Settings,
  [ActivityType.IMPORT_SHOT_SKILL]: Download,
};

function getRelativeTime(date: Date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600)
    return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400)
    return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 604800)
    return `${Math.floor(diffInSeconds / 86400)} days ago`;
  return date.toLocaleDateString();
}

function formatAction(action: ActivityType): string {
  switch (action) {
    case ActivityType.SIGN_UP:
      return 'You signed up';
    case ActivityType.SIGN_IN:
      return 'You signed in';
    case ActivityType.SIGN_OUT:
      return 'You signed out';
    case ActivityType.UPDATE_PASSWORD:
      return 'You changed your password';
    case ActivityType.DELETE_ACCOUNT:
      return 'You deleted your account';
    case ActivityType.UPDATE_ACCOUNT:
      return 'You updated your account';
    case ActivityType.CREATE_TEAM:
      return 'You created a new team';
    case ActivityType.REMOVE_TEAM_MEMBER:
      return 'You removed a team member';
    case ActivityType.INVITE_TEAM_MEMBER:
      return 'You invited a team member';
    case ActivityType.ACCEPT_INVITATION:
      return 'You accepted an invitation';
    case ActivityType.CREATE_BRAND_KIT:
      return 'You created a Brand Kit';
    case ActivityType.UPDATE_BRAND_KIT:
      return 'You updated a Brand Kit';
    case ActivityType.UPLOAD_PRODUCT_ASSET:
      return 'You uploaded a product asset';
    case ActivityType.CREATE_CAMPAIGN:
      return 'You created a Campaign';
    case ActivityType.SELECT_SHOT_CARD:
      return 'You selected a Shot Card';
    case ActivityType.SUBMIT_VIDEO_JOB:
      return 'You submitted a video job';
    case ActivityType.VIDEO_JOB_SUCCEEDED:
      return 'A video job completed';
    case ActivityType.VIDEO_JOB_FAILED:
      return 'A video job failed';
    case ActivityType.RETRY_VIDEO_JOB:
      return 'You retried a video job';
    case ActivityType.ADOPT_VIDEO:
      return 'You adopted a generated video';
    case ActivityType.REJECT_VIDEO:
      return 'You did not adopt a generated video';
    case ActivityType.CREATE_CATALOG_ITEM:
      return 'You created a Catalog SKU';
    case ActivityType.UPDATE_CATALOG_ITEM:
      return 'You updated a Catalog SKU';
    case ActivityType.COPY_CATALOG_ITEM:
      return 'You copied a Catalog SKU';
    case ActivityType.IMPORT_SHOT_SKILL:
      return 'You imported a private Shot Skill';
    default:
      return 'Unknown action occurred';
  }
}

export default async function ActivityPage() {
  const logs = await getActivityLogs();

  return (
    <section className="flex-1 p-4 lg:p-8">
      <h1 className="text-lg lg:text-2xl font-medium text-gray-900 mb-6">
        Activity Log
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length > 0 ? (
            <ul className="space-y-4">
              {logs.map((log) => {
                const Icon = iconMap[log.action as ActivityType] || Settings;
                const formattedAction = formatAction(
                  log.action as ActivityType
                );

                return (
                  <li key={log.id} className="flex items-center space-x-4">
                    <div className="bg-orange-100 rounded-full p-2">
                      <Icon className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {formattedAction}
                        {log.ipAddress && ` from IP ${log.ipAddress}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        {getRelativeTime(new Date(log.timestamp))}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <AlertCircle className="h-12 w-12 text-orange-500 mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No activity yet
              </h3>
              <p className="text-sm text-gray-500 max-w-sm">
                When you perform actions like signing in or updating your
                account, they'll appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
