import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import pagesFile from '../form-pages.json'
import promptsFile from '../prompts.json'
import './App.css'

type FormItem = {
  area: string
  question: string
  help: string
}

type FormPage = {
  title: string
  items: FormItem[]
}

type FormPagesFile = {
  pages: FormPage[]
}

type AnswerMap = Record<string, string>

type StatusMessage = {
  type: 'success' | 'error'
  text: string
}

type PromptMap = Record<string, string>

type PerplexityChatMessageContentChunk = {
  type?: string
  text?: string
  [key: string]: unknown
}

type PerplexityChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | PerplexityChatMessageContentChunk[]
}

type PerplexityChatCompletionChoice = {
  index: number
  message?: PerplexityChatMessage
}

type PerplexityChatCompletionResponse = {
  choices?: PerplexityChatCompletionChoice[]
}

type CompetitorEntry = {
  name: string
  website: string
  description: string
  successLikelihood: string
}

type AiActionKey = 'tamsamsom' | 'competitors' | 'porter' | 'onepager'

type AiActionConfig = {
  stepIndex: number
  promptKey: string
  buttonLabel: string
  description: string
  successMessage: string
  parseResult: (text: string, stepIndex: number) => AnswerMap
  model?: string
}

type FormFieldDescriptor = {
  fieldId: string
  pageTitle: string
  question: string
}

type PrefillAnswerEntry = {
  fieldId: string
  value: string
}

marked.setOptions({
  gfm: true,
  breaks: true,
})

const { pages: formPages } = pagesFile as FormPagesFile
const prompts = promptsFile as PromptMap
const summaryStepIndex = formPages.length
const stepLabels = [...formPages.map((page) => page.title), 'Resumen']
const tamSamSomStepIndex = formPages.findIndex(
  (page) => page.title.toLowerCase().replace(/\s+/g, '') === 'tamsamsom',
)
const competitorListStepIndex = formPages.findIndex(
  (page) => page.title.toLowerCase().replace(/\s+/g, '') === 'listadecompetidores',
)
const porterStepIndex = formPages.findIndex(
  (page) => page.title.toLowerCase().replace(/\s+/g, '') === 'análisisporter',
)
const onePagerStepIndex = formPages.findIndex(
  (page) => page.title.toLowerCase().replace(/\s+/g, '') === 'onepager',
)

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const makeFieldId = (pageIndex: number, question: string) =>
  `step-${pageIndex}-${slugify(question)}`
const estadoQuestionId = (() => {
  const pageIndex = formPages.findIndex((page) =>
    page.items.some((item) => item.question.trim().toLowerCase() === 'estado'),
  )

  if (pageIndex === -1) {
    return null
  }

  const item = formPages[pageIndex].items.find(
    (field) => field.question.trim().toLowerCase() === 'estado',
  )
  return item ? makeFieldId(pageIndex, item.question) : null
})()
const estadoOptions = ['Idea', 'Prototipo', 'Ventas iniciales', 'Escala'] as const

const formFieldDescriptors: FormFieldDescriptor[] = formPages.flatMap((page, pageIndex) =>
  page.items.map((item) => ({
    fieldId: makeFieldId(pageIndex, item.question),
    pageTitle: page.title,
    question: item.question,
  })),
)

const validFieldIdSet = new Set(formFieldDescriptors.map((field) => field.fieldId))

const fieldsCatalogForPrompt = formFieldDescriptors
  .map((field) => `- ${field.fieldId}: [${field.pageTitle}] ${field.question}`)
  .join('\n')

const prefillFieldId = 'prefill-brief-markdown'

const asText = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value)
  }
  return ''
}

const parseAiResult = (
  text: string,
): { tam: string; sam: string; som: string } | null => {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const tryParseJson = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const tam = asText(parsed.tam ?? parsed.TAM)
      const sam = asText(parsed.sam ?? parsed.SAM)
      const som = asText(parsed.som ?? parsed.SOM)
      if (tam && sam && som) {
        return { tam, sam, som }
      }
    } catch {
      /* noop */
    }
    return null
  }

  const jsonCandidate = tryParseJson(trimmed)
  if (jsonCandidate) {
    return jsonCandidate
  }

  const blockMatch = trimmed.match(/\{[\s\S]+\}/)
  if (blockMatch) {
    const blockParsed = tryParseJson(blockMatch[0])
    if (blockParsed) {
      return blockParsed
    }
  }

  const sections: Record<'tam' | 'sam' | 'som', string> = {
    tam: '',
    sam: '',
    som: '',
  }
  const regex = /(TAM|SAM|SOM)[^:]*:\s*([\s\S]*?)(?=(TAM|SAM|SOM)[^:]*:|$)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(trimmed)) !== null) {
    const key = match[1].toLowerCase() as 'tam' | 'sam' | 'som'
    sections[key] = match[2].trim()
  }

  if (sections.tam && sections.sam && sections.som) {
    return sections
  }

  return null
}

const sanitizeTableCell = (value: string) => value.replace(/\|/g, '\\|').trim()

const parseCompetitorEntries = (text: string): CompetitorEntry[] | null => {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const tryParse = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { competitors?: unknown }).competitors)
          ? (parsed as { competitors?: unknown[] }).competitors
          : null

      if (!list || list.length === 0) {
        return null
      }

      const normalized = list
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null
          }
          const record = entry as Record<string, unknown>
          const name =
            asText(
              record.name ??
                record.Nombre ??
                record.title ??
                record.company ??
                record.organisation,
            ) || 'Competidor sin nombre'
          const website =
            asText(
              record.website ??
                record.url ??
                record.link ??
                record.site ??
                record.Web ??
                record.web,
            ) || 'N/D'
          const description =
            asText(
              record.description ??
                record.descripcion ??
                record.summary ??
                record.detalle ??
                record.detalles,
            ) || 'Descripción no disponible'
          const success =
            asText(
              record.successLikelihood ??
                record.success_probability ??
                record.successProbability ??
                record.success ??
                record.probability ??
                record['probabilidad'],
            ) || 'Sin estimación'

          return {
            name,
            website,
            description,
            successLikelihood: success,
          }
        })
        .filter(Boolean) as CompetitorEntry[]

      return normalized.length ? normalized : null
    } catch {
      return null
    }
  }

  const direct = tryParse(trimmed)
  if (direct) {
    return direct
  }

  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/)
  if (blockMatch) {
    const blockParsed = tryParse(blockMatch[1])
    if (blockParsed) {
      return blockParsed
    }
  }

  return null
}

const formatCompetitorTable = (entries: CompetitorEntry[]) => {
  const header = 'Nombre | Web | Descripción | Probabilidad de Éxito'
  const separator = '--- | --- | --- | ---'
  const rows = entries.map((entry) => {
    const row = [
      sanitizeTableCell(entry.name),
      sanitizeTableCell(entry.website),
      sanitizeTableCell(entry.description),
      sanitizeTableCell(entry.successLikelihood),
    ]
    return row.join(' | ')
  })
  return [header, separator, ...rows].join('\n')
}

const applyTamSamSomResult = (text: string, stepIndex: number): AnswerMap => {
  const structured = parseAiResult(text)
  if (!structured) {
    throw new Error('No pudimos interpretar la respuesta del modelo.')
  }

  const items = formPages[stepIndex]?.items ?? []
  const itemIds = items.map((item) => makeFieldId(stepIndex, item.question))
  if (itemIds.length < 3) {
    throw new Error('No encontramos los campos de TAM, SAM y SOM en el formulario.')
  }

  return {
    [itemIds[0]]: structured.tam,
    [itemIds[1]]: structured.sam,
    [itemIds[2]]: structured.som,
  }
}

const applyCompetitorsResult = (text: string, stepIndex: number): AnswerMap => {
  const entries = parseCompetitorEntries(text)
  if (!entries) {
    throw new Error('No pudimos interpretar la lista de competidores devuelta por la IA.')
  }

  const page = formPages[stepIndex]
  const question = page?.items?.[0]?.question
  if (!question) {
    throw new Error('No encontramos el campo de competidores en el formulario.')
  }

  const fieldId = makeFieldId(stepIndex, question)
  return {
    [fieldId]: formatCompetitorTable(entries),
  }
}

const parsePorterResult = (
  text: string,
): {
  clientPower: string
  supplierPower: string
  substitutesThreat: string
  newEntrantsThreat: string
  competitiveRivalry: string
} | null => {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const tryParseJson = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (
        typeof parsed.clientPower === 'string' &&
        typeof parsed.supplierPower === 'string' &&
        typeof parsed.substitutesThreat === 'string' &&
        typeof parsed.newEntrantsThreat === 'string' &&
        typeof parsed.competitiveRivalry === 'string'
      ) {
        return {
          clientPower: parsed.clientPower,
          supplierPower: parsed.supplierPower,
          substitutesThreat: parsed.substitutesThreat,
          newEntrantsThreat: parsed.newEntrantsThreat,
          competitiveRivalry: parsed.competitiveRivalry,
        }
      }
      return null
    } catch {
      return null
    }
  }

  const direct = tryParseJson(trimmed)
  if (direct) {
    return direct
  }

  const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/)
  if (blockMatch) {
    const blockParsed = tryParseJson(blockMatch[1])
    if (blockParsed) {
      return blockParsed
    }
  }

  return null
}

const applyPorterResult = (text: string, stepIndex: number): AnswerMap => {
  const structured = parsePorterResult(text)
  if (!structured) {
    throw new Error('No pudimos interpretar el análisis Porter devuelto por la IA.')
  }

  const items = formPages[stepIndex]?.items ?? []
  if (items.length < 5) {
    throw new Error('No encontramos los 5 campos del análisis Porter en el formulario.')
  }

  const itemIds = items.map((item) => makeFieldId(stepIndex, item.question))

  return {
    [itemIds[0]]: structured.clientPower,
    [itemIds[1]]: structured.supplierPower,
    [itemIds[2]]: structured.substitutesThreat,
    [itemIds[3]]: structured.newEntrantsThreat,
    [itemIds[4]]: structured.competitiveRivalry,
  }
}

const applyOnePagerResult = (text: string, stepIndex: number): AnswerMap => {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('La IA no devolvió contenido para el one-pager.')
  }

  const page = formPages[stepIndex]
  const question = page?.items?.[0]?.question
  if (!question) {
    throw new Error('No encontramos el campo del one-pager en el formulario.')
  }

  const fieldId = makeFieldId(stepIndex, question)
  return {
    [fieldId]: trimmed,
  }
}

const normalizePrefillEntries = (input: unknown): PrefillAnswerEntry[] | null => {
  if (!input) {
    return null
  }

  if (Array.isArray(input)) {
    const entries = input
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const record = entry as Record<string, unknown>
        const fieldId = asText(record.fieldId ?? record.id ?? record.field ?? record.key)
        const value = asText(record.value ?? record.answer ?? record.text ?? record.content)
        if (!fieldId || !value) {
          return null
        }
        return { fieldId, value }
      })
      .filter(Boolean) as PrefillAnswerEntry[]

    return entries.length ? entries : null
  }

  if (typeof input === 'object') {
    const record = input as Record<string, unknown>
    const nestedKeys = ['answers', 'filledAnswers', 'fields', 'entries', 'items', 'data']
    for (const key of nestedKeys) {
      if (record[key] !== undefined) {
        const nested = normalizePrefillEntries(record[key])
        if (nested?.length) {
          return nested
        }
      }
    }

    const directEntries = Object.entries(record)
      .map(([fieldId, rawValue]) => {
        if (!validFieldIdSet.has(fieldId)) {
          return null
        }
        const value = asText(rawValue)
        if (!value) {
          return null
        }
        return { fieldId, value }
      })
      .filter(Boolean) as PrefillAnswerEntry[]

    return directEntries.length ? directEntries : null
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      return normalizePrefillEntries(parsed)
    } catch {
      return null
    }
  }

  return null
}

const applyPrefillResult = (text: string): AnswerMap => {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('La IA no devolvió un JSON con campos a pre-rellenar.')
  }

  const tryParse = (payload: string) => {
    try {
      const parsed = JSON.parse(payload) as unknown
      return normalizePrefillEntries(parsed)
    } catch {
      return null
    }
  }

  let entries = tryParse(trimmed)
  if (!entries) {
    const blockMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/)
    if (blockMatch) {
      entries = tryParse(blockMatch[1])
    }
  }
  if (!entries) {
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      entries = tryParse(trimmed.slice(firstBrace, lastBrace + 1))
    }
  }

  if (!entries) {
    throw new Error('No pudimos interpretar los campos pre-rellenados enviados por la IA.')
  }

  const recognizedEntries = entries.filter(
    (entry) => validFieldIdSet.has(entry.fieldId) && entry.value.trim(),
  )
  if (!recognizedEntries.length) {
    throw new Error('La IA no devolvió campos conocidos para completar.')
  }

  return recognizedEntries.reduce<AnswerMap>((acc, entry) => {
    acc[entry.fieldId] = entry.value.trim()
    return acc
  }, {})
}

const extractMessageContent = (content: PerplexityChatMessage['content']): string => {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((chunk) => {
      if (!chunk) {
        return ''
      }
      if (typeof chunk === 'string') {
        return chunk
      }
      if (typeof chunk === 'object' && 'text' in chunk && typeof chunk.text === 'string') {
        return chunk.text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

const aiActionConfigs: Record<AiActionKey, AiActionConfig> = {
  tamsamsom: {
    stepIndex: tamSamSomStepIndex,
    promptKey: 'tamsamsom',
    buttonLabel: 'Research using AI',
    description:
      'Usa tus respuestas previas para estimar TAM, SAM y SOM automáticamente con Perplexity.',
    successMessage: 'Investigación de mercado completada con IA.',
    parseResult: applyTamSamSomResult,
  },
  competitors: {
    stepIndex: competitorListStepIndex,
    promptKey: 'competitors',
    buttonLabel: 'Research using AI',
    description:
      'Genera una lista priorizada de competidores con IA usando todo el contexto anterior.',
    successMessage: 'Lista de competidores generada con IA.',
    parseResult: applyCompetitorsResult,
  },
  porter: {
    stepIndex: porterStepIndex,
    promptKey: 'porter',
    buttonLabel: 'Analizar con IA',
    description:
      'Realiza un análisis de las 5 fuerzas de Porter con IA usando todo el contexto del proyecto.',
    successMessage: 'Análisis Porter completado con IA.',
    parseResult: applyPorterResult,
  },
  onepager: {
    stepIndex: onePagerStepIndex,
    promptKey: 'onepager',
    buttonLabel: 'Generar One-pager con IA',
    description:
      'Recopila todas tus respuestas en un one-pager ejecutivo listo para compartir.',
    successMessage: 'One-pager generado con IA.',
    parseResult: applyOnePagerResult,
    model: 'sonar-reasoning-pro',
  },
}

type MarkdownEditorProps = {
  fieldId: string
  value: string
  rows: number
  ariaDescribedBy: string
  ariaLabelledBy: string
  isEditing: boolean
  onStartEditing: () => void
  onStopEditing: () => void
  onChangeValue: (value: string) => void
}

const MarkdownEditor = ({
  fieldId,
  value,
  rows,
  ariaDescribedBy,
  ariaLabelledBy,
  isEditing,
  onStartEditing,
  onStopEditing,
  onChangeValue,
}: MarkdownEditorProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const sanitizedMarkdown = useMemo(() => {
    if (!value.trim()) {
      return ''
    }
    const parsed = marked.parse(value)
    return typeof parsed === 'string' ? DOMPurify.sanitize(parsed) : ''
  }, [value])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      )
    }
  }, [isEditing])

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onStartEditing()
    }
  }

  if (isEditing) {
    return (
      <textarea
        id={fieldId}
        ref={textareaRef}
        aria-describedby={ariaDescribedBy}
        aria-labelledby={ariaLabelledBy}
        value={value}
        onFocus={onStartEditing}
        onBlur={onStopEditing}
        onChange={(event) => onChangeValue(event.target.value)}
        rows={rows}
        placeholder="Escribe tu respuesta usando Markdown..."
      />
    )
  }

  const hasContent = Boolean(sanitizedMarkdown)

  return (
    <div
      className={`markdown-preview${hasContent ? '' : ' empty'}`}
      role="button"
      tabIndex={0}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      onClick={onStartEditing}
      onKeyDown={handlePreviewKeyDown}
    >
      {hasContent ? (
        <div
          className="markdown-preview-content"
          dangerouslySetInnerHTML={{ __html: sanitizedMarkdown }}
        />
      ) : (
        <span className="placeholder">
          Haz clic para escribir y usa Markdown para dar formato.
        </span>
      )}
    </div>
  )
}

function App() {
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [activeAiAction, setActiveAiAction] = useState<AiActionKey | null>(null)
  const [editingMarkdownField, setEditingMarkdownField] = useState<string | null>(null)
  const [prefillMarkdown, setPrefillMarkdown] = useState('')
  const [isPrefillLoading, setIsPrefillLoading] = useState(false)

  const isSummaryStep = currentStep === summaryStepIndex
  const isFirstStep = currentStep === 0
  const progressPercent = (currentStep / (stepLabels.length - 1)) * 100

  const setSuccess = useCallback(
    (text: string) => setStatusMessage({ type: 'success', text }),
    [],
  )
  const setError = useCallback(
    (text: string) => setStatusMessage({ type: 'error', text }),
    [],
  )

  const handleInputChange = useCallback((fieldId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }))
  }, [])

  const goToStep = useCallback((stepIndex: number) => {
    setCurrentStep(Math.max(0, Math.min(stepIndex, summaryStepIndex)))
  }, [])

  const handleNext = () => {
    if (isSummaryStep) {
      handleExport()
      return
    }

    goToStep(currentStep + 1)
  }

  const handleBack = () => {
    goToStep(currentStep - 1)
  }

  const handleExport = () => {
    try {
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        currentStep,
        answers,
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'busup-canvas.json'
      link.click()
      URL.revokeObjectURL(url)
      setSuccess('Descargaste un archivo con toda la información.')
    } catch (error) {
      console.error(error)
      setError('No se pudo exportar el archivo.')
    }
  }

  const parseImport = useCallback(
    (text: string) => {
      const parsed = JSON.parse(text) as {
        answers?: Record<string, unknown>
        currentStep?: unknown
      }

      if (!parsed || typeof parsed !== 'object' || !parsed.answers) {
        throw new Error('El archivo no contiene respuestas.')
      }

      const sanitizedAnswers = Object.entries(parsed.answers).reduce<AnswerMap>(
        (acc, [key, value]) => {
          if (typeof value === 'string') {
            acc[key] = value
          }
          return acc
        },
        {},
      )

      const importedStep =
        typeof parsed.currentStep === 'number' && !Number.isNaN(parsed.currentStep)
          ? Math.max(0, Math.min(parsed.currentStep, summaryStepIndex))
          : 0

      setAnswers(sanitizedAnswers)
      goToStep(importedStep)
      setSuccess('Archivo importado correctamente.')
    },
    [goToStep, setSuccess],
  )

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return
      }

      try {
        const text = await files[0].text()
        parseImport(text)
      } catch (error) {
        console.error(error)
        setError('No reconocemos el archivo. Asegúrate de exportarlo desde la app.')
      }
    },
    [parseImport, setError],
  )

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files)
    event.target.value = ''
  }

  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      const hasFiles = Array.from(event.dataTransfer?.types ?? []).includes('Files')
      if (!hasFiles) return

      event.preventDefault()
      event.dataTransfer!.dropEffect = 'copy'
      setDragActive(true)
    }

    const handleDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) {
        setDragActive(false)
      }
    }

    const handleDrop = (event: DragEvent) => {
      const hasFiles = event.dataTransfer?.files && event.dataTransfer.files.length > 0
      if (!hasFiles) {
        setDragActive(false)
        return
      }
      event.preventDefault()
      setDragActive(false)
      void handleFiles(event.dataTransfer!.files)
    }

    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleFiles])

  useEffect(() => {
    if (!statusMessage) {
      return
    }

    const timeout = setTimeout(() => setStatusMessage(null), 5000)
    return () => clearTimeout(timeout)
  }, [statusMessage])

  const currentPage = isSummaryStep ? null : formPages[currentStep]
  const primaryButtonLabel = isSummaryStep
    ? 'Descargar resumen'
    : currentStep === summaryStepIndex - 1
      ? 'Ver resumen'
      : 'Siguiente'
  const currentAiActionEntry = (
    Object.entries(aiActionConfigs) as [AiActionKey, AiActionConfig][]
  ).find(([, config]) => config.stepIndex === currentStep)
  const currentAiActionKey = currentAiActionEntry?.[0] ?? null
  const currentAiAction = currentAiActionEntry?.[1] ?? null
  const isAiActionLoading = activeAiAction !== null
  const isCurrentActionLoading =
    currentAiActionKey !== null && activeAiAction === currentAiActionKey
  const hasPrefillContext = Boolean(prefillMarkdown.trim())
  const prefillHelpId = `${prefillFieldId}-help`
  const isPrefillEditing = editingMarkdownField === prefillFieldId

  const buildBusinessContext = useCallback((targetStepIndex: number) => {
    if (targetStepIndex <= 0) {
      return 'Sin respuestas previas disponibles.'
    }

    const sections = formPages
      .slice(0, targetStepIndex)
      .map((page, pageIndex) => {
        const entries = page.items
          .map((item) => {
            const fieldId = makeFieldId(pageIndex, item.question)
            const answer = answers[fieldId]
            if (!answer?.trim()) {
              return null
            }
            return `- ${item.question}: ${answer.trim()}`
          })
          .filter(Boolean)
        if (entries.length === 0) {
          return null
        }
        return `${page.title}:\n${entries.join('\n')}`
      })
      .filter(Boolean)

    return sections.length > 0 ? sections.join('\n\n') : 'Sin respuestas previas disponibles.'
  }, [answers])

  const handleAiAction = useCallback(
    async (actionKey: AiActionKey) => {
      const action = aiActionConfigs[actionKey]
      if (!action || action.stepIndex === -1) {
        setError('No encontramos la sección correspondiente para la investigación.')
        return
      }

      const promptText = (prompts?.[action.promptKey] ?? '').trim()
      if (!promptText) {
        setError('El prompt de investigación no está disponible.')
        return
      }

      const apiKey = import.meta.env.VITE_PERPLEXITY_API_KEY
      if (!apiKey) {
        setError('Configura VITE_PERPLEXITY_API_KEY en tu archivo .env para usar la investigación.')
        return
      }

      setActiveAiAction(actionKey)
      try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: action.model ?? 'sonar-pro',
            temperature: 0.1,
            messages: [
              {
                role: 'user',
                content: `${promptText}\n${buildBusinessContext(action.stepIndex)}`,
              },
            ],
          }),
        })

        if (!response.ok) {
          throw new Error('La API de Perplexity respondió con un error.')
        }

        const payload = (await response.json()) as PerplexityChatCompletionResponse
        const aiText = extractMessageContent(payload.choices?.[0]?.message?.content ?? '')
        if (!aiText.trim()) {
          throw new Error('La respuesta de la IA vino vacía.')
        }

        const updates = action.parseResult(aiText, action.stepIndex)
        setAnswers((prev) => ({ ...prev, ...updates }))
        setSuccess(action.successMessage)
      } catch (error) {
        console.error('Perplexity chat error', error)
        setError(
          error instanceof Error
            ? error.message
            : 'No pudimos completar la investigación automática.',
        )
      } finally {
        setActiveAiAction(null)
      }
    },
    [buildBusinessContext, setError, setSuccess],
  )

  const handlePrefillWithAi = useCallback(async () => {
    const brief = prefillMarkdown.trim()
    if (!brief) {
      setError('Pegá el contenido en Markdown antes de pedir el pre-relleno.')
      return
    }

    const promptText = (prompts?.prefill ?? '').trim()
    if (!promptText) {
      setError('El prompt para pre-rellenar con IA no está disponible.')
      return
    }

    const apiKey = import.meta.env.VITE_PERPLEXITY_API_KEY
    if (!apiKey) {
      setError('Configura VITE_PERPLEXITY_API_KEY en tu archivo .env para usar la investigación.')
      return
    }

    setIsPrefillLoading(true)
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'sonar-reasoning-pro',
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: `${promptText}\n${fieldsCatalogForPrompt}\n\nBrief en Markdown:\n${brief}`,
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error('La API de Perplexity respondió con un error.')
      }

      const payload = (await response.json()) as PerplexityChatCompletionResponse
      const aiText = extractMessageContent(payload.choices?.[0]?.message?.content ?? '')
      if (!aiText.trim()) {
        throw new Error('La respuesta de la IA vino vacía.')
      }

      const updates = applyPrefillResult(aiText)
      const sanitizedEntries = Object.entries(updates).filter(([fieldId, value]) => {
        const trimmedValue = value?.trim()
        if (!trimmedValue) {
          return false
        }
        const existing = answers[fieldId]
        return !existing?.trim()
      })

      if (!sanitizedEntries.length) {
        throw new Error(
          'La IA no encontró campos vacíos para completar con el brief proporcionado.',
        )
      }

      const sanitizedUpdates = Object.fromEntries(sanitizedEntries)
      setAnswers((prev) => ({ ...prev, ...sanitizedUpdates }))
      setSuccess('Pre-rellenamos algunos campos usando tu brief. Revisalos antes de avanzar.')
    } catch (error) {
      console.error('Prefill chat error', error)
      setError(
        error instanceof Error
          ? error.message
          : 'No pudimos pre-rellenar los campos automáticamente.',
      )
    } finally {
      setIsPrefillLoading(false)
    }
  }, [answers, prefillMarkdown, setError, setSuccess])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Canvas sin fricción</p>
          <h1>Busup Venture Canvas</h1>
          <p className="subhead">
            Completa cada bloque, avanza con los botones o las migas y exporta un archivo
            listo para compartir.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="ghost-button" onClick={handleExport}>
            Exportar respuestas
          </button>
          <label className="ghost-button file-button">
            Cargar archivo
            <input type="file" accept="application/json" onChange={handleFileInput} />
          </label>
        </div>
      </header>

      <nav className="breadcrumbs" aria-label="Progreso del formulario">
        {stepLabels.map((label, index) => {
          const state =
            index === currentStep ? 'active' : index < currentStep ? 'complete' : 'pending'
          return (
            <button
              key={label}
              type="button"
              className={`breadcrumb ${state}`}
              onClick={() => goToStep(index)}
            >
              <span className="breadcrumb-index">{index + 1}</span>
              <span className="breadcrumb-label">{label}</span>
            </button>
          )
        })}
      </nav>

      <section className="content-card">
        {statusMessage && (
          <div className={`status-banner ${statusMessage.type}`}>{statusMessage.text}</div>
        )}

        {!isSummaryStep && currentPage ? (
          <>
            <header className="page-header">
              <p className="page-count">
                Paso {currentStep + 1} de {stepLabels.length}
              </p>
              <h2>{currentPage.title}</h2>
            </header>
            {isFirstStep && (
              <section className="prefill-brief" aria-labelledby={`${prefillFieldId}-label`}>
                <div className="prefill-brief-copy">
                  <p className="prefill-brief-eyebrow">Acelera tu primer paso</p>
                  <h3 id={`${prefillFieldId}-label`}>¿Tenés un brief listo en Markdown?</h3>
                  <p className="prefill-brief-description">
                    Pegá aquí cualquier texto largo que describa tu negocio. Si encontramos datos
                    confiables pre-rellenaremos los campos y pediremos aclaraciones usando mensajes
                    en <strong>NEGRITA MAYÚSCULA</strong>. Podés dejarlo vacío si preferís completar
                    campo por campo.
                  </p>
                </div>
                <MarkdownEditor
                  fieldId={prefillFieldId}
                  value={prefillMarkdown}
                  rows={8}
                  ariaDescribedBy={prefillHelpId}
                  ariaLabelledBy={`${prefillFieldId}-label`}
                  isEditing={isPrefillEditing}
                  onStartEditing={() => setEditingMarkdownField(prefillFieldId)}
                  onStopEditing={() =>
                    setEditingMarkdownField((current) => (current === prefillFieldId ? null : current))
                  }
                  onChangeValue={(value) => setPrefillMarkdown(value)}
                />
                <small id={prefillHelpId}>
                  Este paso es opcional. Nos limitaremos a rellenar campos respaldados por el brief y
                  destacaremos las dudas con mensajes en negrita y mayúsculas.
                </small>
                <div className="prefill-brief-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handlePrefillWithAi}
                    disabled={!hasPrefillContext || isPrefillLoading}
                  >
                    {isPrefillLoading ? 'Pre-rellenando...' : 'Pre-rellenar con IA'}
                  </button>
                  <span>
                    Solo completamos campos con evidencia explícita; de lo contrario verás mensajes
                    como <code>**PLEASE ENTER MANUALLY**</code>.
                  </span>
                </div>
              </section>
            )}
            {currentAiAction && currentAiActionKey && (
              <div className="ai-research-banner">
                <div>
                  <p>{currentAiAction.description}</p>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => handleAiAction(currentAiActionKey)}
                  disabled={isAiActionLoading}
                >
                  {isCurrentActionLoading ? 'Investigando...' : currentAiAction.buttonLabel}
                </button>
              </div>
            )}

            <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
              {currentPage.items.map((item, itemIndex) => {
                const fieldId = makeFieldId(currentStep, item.question)
                const helpId = `${fieldId}-help`
                const answer = answers[fieldId] ?? ''
                const isMarkdownField = fieldId !== estadoQuestionId
                const isEditing = editingMarkdownField === fieldId
                return (
                  <div key={`${fieldId}-${itemIndex}`} className="form-field">
                    <div className="field-top">
                      <span className="area-pill">{item.area}</span>
                      <h3 id={`${fieldId}-label`}>{item.question}</h3>
                    </div>
                    {isMarkdownField ? (
                      <MarkdownEditor
                        fieldId={fieldId}
                        value={answer}
                        rows={item.help.length > 120 ? 6 : 4}
                        ariaDescribedBy={helpId}
                        ariaLabelledBy={`${fieldId}-label`}
                        isEditing={isEditing}
                        onStartEditing={() => setEditingMarkdownField(fieldId)}
                        onStopEditing={() =>
                          setEditingMarkdownField((current) => (current === fieldId ? null : current))
                        }
                        onChangeValue={(value) => handleInputChange(fieldId, value)}
                      />
                    ) : (
                      <div
                        className="radio-group"
                        role="radiogroup"
                        aria-labelledby={`${fieldId}-label`}
                        aria-describedby={helpId}
                      >
                        {estadoOptions.map((option) => (
                          <label
                            key={option}
                            className={`radio-pill${answer === option ? ' selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name={fieldId}
                              value={option}
                              checked={answer === option}
                              onChange={(event) => handleInputChange(fieldId, event.target.value)}
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <small id={helpId}>{item.help}</small>
                  </div>
                )
              })}
            </form>
          </>
        ) : (
          <section className="summary">
            <header className="page-header">
              <p className="page-count">
                Paso {stepLabels.length} de {stepLabels.length}
              </p>
              <h2>Resumen general</h2>
              <p className="summary-hint">
                Revisa y descarga tus respuestas. Puedes regresar para editar cualquier bloque
                antes de exportar.
              </p>
            </header>
            <div className="summary-grid">
              {formPages.map((page, pageIndex) => (
                <article key={page.title} className="summary-block">
                  <h3>{page.title}</h3>
                  <dl>
                    {page.items.map((item) => {
                      const fieldId = makeFieldId(pageIndex, item.question)
                      const value = answers[fieldId]
                      return (
                        <div key={fieldId} className="summary-row">
                          <dt>
                            <span className="area-pill">{item.area}</span>
                            {item.question}
                          </dt>
                          <dd>{value?.trim() ? value : <span className="empty">Sin respuesta</span>}</dd>
                        </div>
                      )
                    })}
                  </dl>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>

      <footer className="nav-footer">
        <button
          type="button"
          className="ghost-button"
          onClick={handleBack}
          disabled={currentStep === 0}
        >
          Anterior
        </button>
        <div className="progress-track" aria-label="Progreso">
          <div className="progress-value" style={{ width: `${progressPercent}%` }} />
        </div>
        <button type="button" className="primary-button" onClick={handleNext}>
          {primaryButtonLabel}
        </button>
      </footer>

      {dragActive && (
        <div className="drop-overlay">
          <div>
            <p>Soltá el archivo exportado para cargar las respuestas.</p>
            <small>También podés usar el botón &quot;Cargar archivo&quot;.</small>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
