import {it,expect,vi} from 'vitest';
vi.mock('./api',()=>({apiFetch:vi.fn()}));
vi.mock('./apiSession',()=>({ensureApiSession:vi.fn()}));
vi.mock('./store',()=>({candidateFullName:()=> 'Candidate'}));
vi.mock('./clientLlm',()=>({clientLlmAllowed:()=>false}));
vi.mock('./interviewInviteGate',()=>({readStoredInterviewInvite:()=>({token:'test-invite'})}));
vi.mock('./adaptiveInterview',()=>({generateLocalAdaptiveQuestion:vi.fn(),INTERVIEW_TURN_COUNT:6}));
vi.mock('./localInterview',()=>({buildResumeInterviewQuestions:vi.fn(),runLocalInterviewScore:vi.fn()}));
vi.mock('./interviewQuestionGeneration',()=>({generateAdaptiveQuestionClient:vi.fn(),resolveInterviewTotalTurns:vi.fn(),summarizeProfileForQuestions:vi.fn()}));
import {apiFetch} from './api';
import {generateLocalAdaptiveQuestion} from './adaptiveInterview';
import {startInterviewSession} from './interviewAgentClient';
it('sends the invitation token and never starts offline after the server rejects an expired invite',async()=>{
  vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({error:'This invitation has expired.'}),{status:410}));
  await expect(startInterviewSession('Developer','Fresher',null)).rejects.toThrow('expired');
  const body=JSON.parse(vi.mocked(apiFetch).mock.calls[0][1]?.body as string);
  expect(body.inviteToken).toBe('test-invite');
  expect(generateLocalAdaptiveQuestion).not.toHaveBeenCalled();
});
