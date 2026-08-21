import { LOCAL_DEMO_COMPLAINT_CONTENT } from '../../src/demo/mainComplaint'

export const MAIN_COMPLAINT = {
  content: LOCAL_DEMO_COMPLAINT_CONTENT,
  expectedFacts: {
    customer: '华东精工',
    product: 'BR-2045',
    batch: 'A240819',
    defect: '尺寸超差',
    impact: '装配线停线 4 小时',
    request: '立即说明临时遏制措施',
  },
} as const
