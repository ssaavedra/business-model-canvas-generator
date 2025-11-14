import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
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

const { pages: formPages } = pagesFile as FormPagesFile
const prompts = promptsFile as PromptMap
const tamsamsomPrompt = (prompts?.tamsamsom ?? '').trim()
const summaryStepIndex = formPages.length
const stepLabels = [...formPages.map((page) => page.title), 'Resumen']
const tamSamSomStepIndex = formPages.findIndex(
  (page) => page.title.toLowerCase().replace(/\s+/g, '') === 'tamsamsom',
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

function App() {
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isResearching, setIsResearching] = useState(false)

  const isSummaryStep = currentStep === summaryStepIndex
  const progressPercent = (currentStep / (stepLabels.length - 1)) * 100
  const isTamSamSomStep = currentStep === tamSamSomStepIndex

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

  const buildBusinessContext = useCallback(() => {
    if (tamSamSomStepIndex <= 0) {
      return 'Sin respuestas previas disponibles.'
    }

    const sections = formPages
      .slice(0, tamSamSomStepIndex)
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
  }, [answers, tamSamSomStepIndex])

  const handleResearchUsingAi = useCallback(async () => {
    if (tamSamSomStepIndex === -1) {
      setError('No encontramos la sección de mercado para ejecutar la investigación.')
      return
    }

    if (!tamsamsomPrompt) {
      setError('El prompt de investigación no está disponible.')
      return
    }

    const apiKey = import.meta.env.VITE_PERPLEXITY_API_KEY
    if (!apiKey) {
      setError('Configura VITE_PERPLEXITY_API_KEY en tu archivo .env para usar la investigación.')
      return
    }

    setIsResearching(true)
    try {
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: `${tamsamsomPrompt}\n${buildBusinessContext()}`,
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error('La API de Perplexity respondió con un error.')
      }

      const payload = (await response.json()) as PerplexityChatCompletionResponse
      const firstChoice = payload.choices?.[0]
      const aiText = extractMessageContent(firstChoice?.message?.content ?? '')
      if (!aiText.trim()) {
        throw new Error('La respuesta de la IA vino vacía.')
      }

      const structured = parseAiResult(aiText)
      if (!structured) {
        throw new Error('No pudimos interpretar la respuesta del modelo.')
      }

      const itemIds = formPages[tamSamSomStepIndex].items.map((item) =>
        makeFieldId(tamSamSomStepIndex, item.question),
      )
      if (itemIds.length < 3) {
        throw new Error('No encontramos los campos de TAM, SAM y SOM en el formulario.')
      }

      setAnswers((prev) => ({
        ...prev,
        [itemIds[0]]: structured.tam,
        [itemIds[1]]: structured.sam,
        [itemIds[2]]: structured.som,
      }))
      setSuccess('Investigación completada con IA.')
    } catch (error) {
      console.error('Perplexity search error', error)
      setError(
        error instanceof Error
          ? error.message
          : 'No pudimos completar la investigación automática.',
      )
    } finally {
      setIsResearching(false)
    }
  }, [buildBusinessContext, setError, setSuccess, tamSamSomStepIndex, tamsamsomPrompt])

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
            {isTamSamSomStep && (
              <div className="ai-research-banner">
                <div>
                  <p>
                    Usa tus respuestas previas para estimar TAM, SAM y SOM automáticamente con
                    Perplexity.
                  </p>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleResearchUsingAi}
                  disabled={isResearching}
                >
                  {isResearching ? 'Investigando...' : 'Research using AI'}
                </button>
              </div>
            )}

            <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
              {currentPage.items.map((item, itemIndex) => {
                const fieldId = makeFieldId(currentStep, item.question)
                const helpId = `${fieldId}-help`
                const answer = answers[fieldId] ?? ''
                return (
                  <label key={`${fieldId}-${itemIndex}`} className="form-field" htmlFor={fieldId}>
                    <div className="field-top">
                      <span className="area-pill">{item.area}</span>
                      <h3>{item.question}</h3>
                    </div>
                    <textarea
                      id={fieldId}
                      aria-describedby={helpId}
                      value={answer}
                      onChange={(event) => handleInputChange(fieldId, event.target.value)}
                      rows={item.help.length > 120 ? 6 : 4}
                      placeholder="Escribe tu respuesta..."
                    />
                    <small id={helpId}>{item.help}</small>
                  </label>
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
