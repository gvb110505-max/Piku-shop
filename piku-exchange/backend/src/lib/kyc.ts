/**
 * KYC 연동 자리. 실제 업체(예: 국내 본인확인/eKYC 사업자)를 붙일 때 KycProvider를 구현해 교체한다.
 * 테스트 모드 기본값은 즉시 승인하는 ManualKycProvider(관리자 승인 또는 자동 승인).
 */
export type KycStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface KycStartResult { status: KycStatus; reference: string; redirectUrl?: string }

export interface KycProvider {
  readonly name: string;
  /** 인증 절차 시작. 외부 업체라면 인증 페이지 URL을 반환한다. */
  start(user: { id: string; email: string }): Promise<KycStartResult>;
  /** 업체 웹훅/폴링으로 최신 상태 조회. */
  status(reference: string): Promise<KycStatus>;
}

export class ManualKycProvider implements KycProvider {
  readonly name = 'manual';
  constructor(private autoApprove: boolean) {}
  async start(user: { id: string }): Promise<KycStartResult> {
    return { status: this.autoApprove ? 'approved' : 'pending', reference: `manual:${user.id}` };
  }
  async status(): Promise<KycStatus> { return this.autoApprove ? 'approved' : 'pending'; }
}
