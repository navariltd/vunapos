import { LaunchReadyRoute } from '@/components/splash/LaunchReadiness';
import { SignInScreen } from '@/features/auth/screens/SignInScreen';

export default function SignInRoute() {
  return <LaunchReadyRoute><SignInScreen /></LaunchReadyRoute>;
}
