import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import './App.css'

type Hayon = {
  reference: string
  serie: string
  statut: 'En stock' | 'Sorti'
}

type Profil = {
  role: 'admin' | 'entree' | 'sortie'
  full_name: string
}

type Mouvement = {
  id: number
  reference: string
  serie: string
  type: string
  numero_facture: string | null
  created_at: string
}

// Scanner natif sans dépendance externe : compatible avec les navigateurs
// qui proposent BarcodeDetector. La saisie manuelle reste disponible sinon.
type DetecteurCodeBarres = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>
}

type ConstructeurDetecteur = new (options: { formats: string[] }) => DetecteurCodeBarres

function ScannerCamera({ onScan, onFermer }: {
  onScan: (valeur: string) => void
  onFermer: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const onScanRef = useRef(onScan)
  const [message, setMessage] = useState('Ouverture de la caméra...')

  useEffect(() => { onScanRef.current = onScan }, [onScan])

  useEffect(() => {
    let actif = true
    let flux: MediaStream | null = null
    let animation = 0
    let detecte = false

    const demarrer = async () => {
      try {
        const constructeur = (window as Window & {
          BarcodeDetector?: ConstructeurDetecteur
        }).BarcodeDetector
        if (!constructeur) {
          setMessage('Scanner non pris en charge par ce navigateur. Utilise la saisie manuelle ou un navigateur compatible.')
          return
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setMessage('Caméra indisponible : ouvre le site en HTTPS et autorise la caméra.')
          return
        }
        const detecteur = new constructeur({
          formats: ['code_128', 'code_39', 'ean_8', 'ean_13', 'itf']
        })
        flux = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false
        })
        if (!actif) { flux.getTracks().forEach(p => p.stop()); return }
        const video = videoRef.current
        if (!video) { flux.getTracks().forEach(p => p.stop()); return }
        video.srcObject = flux
        await video.play()
        if (!actif) return
        setMessage('Place le code-barres devant la caméra.')
        let enCours = false
        const lire = async () => {
          if (!actif || detecte) return
          if (!enCours && video.readyState >= 2) {
            enCours = true
            try {
              const codes = await detecteur.detect(video)
              if (!actif) return
              for (const code of codes) {
                const valeur = code.rawValue.trim()
                if (/^\d{8}$/.test(valeur)) {
                  detecte = true
                  onScanRef.current(valeur)
                  return
                }
                setMessage('Code lu : ' + valeur + '. Le numéro de série doit comporter 8 chiffres.')
              }
            } catch (e) { console.warn('Lecture du code-barres :', e) }
            finally { enCours = false }
          }
          if (actif && !detecte) animation = requestAnimationFrame(lire)
        }
        animation = requestAnimationFrame(lire)
      } catch (e) {
        if (actif) setMessage('Impossible d’ouvrir la caméra : ' + String(e))
      }
    }
    void demarrer()
    return () => {
      actif = false
      cancelAnimationFrame(animation)
      flux?.getTracks().forEach(p => p.stop())
      const video = videoRef.current
      if (video) video.srcObject = null
    }
  }, [])

  return (
    <div style={{ margin: '16px 0', padding: 12, background: 'white', borderRadius: 10 }}>
      <video ref={videoRef} muted playsInline autoPlay
        style={{ width: '100%', maxWidth: 450, borderRadius: 8 }} />
      <p role="status">{message}</p>
      <button type="button" className="bouton-principal" onClick={onFermer}>
        Fermer la caméra
      </button>
    </div>
  )
}

function App() {
  const [session, setSession] = useState<any>(null)
  const [profil, setProfil] = useState<Profil | null>(null)
  const [hayons, setHayons] = useState<Hayon[]>([])
  const [mouvements, setMouvements] = useState<Mouvement[]>([])

  const [chargement, setChargement] = useState(true)
  const [operation, setOperation] = useState(false)
  const [erreur, setErreur] = useState('')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [page, setPage] = useState('dashboard')
  const [recherche, setRecherche] = useState('')
  const [reference, setReference] = useState('')
  const [serie, setSerie] = useState('')
  const [seriesSupplementaires, setSeriesSupplementaires] = useState<string[]>([])
  const [numeroFacture, setNumeroFacture] = useState('')
  const [cameraOuverte, setCameraOuverte] = useState(false)
  
  const [utilisateurMotDePasse, setUtilisateurMotDePasse] = useState(
    'facturation@dhollandia.ma'
  )
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setErreur(error.message)
      setSession(data.session)
      if (!data.session) setChargement(false)
    }).catch(e => {
      setErreur('Session inaccessible : ' + String(e))
      setChargement(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nouvelleSession) => {
        setSession(nouvelleSession)

        if (!nouvelleSession) {
          setProfil(null)
          setHayons([])
          setMouvements([])
          setChargement(false)
        }
      }
    )

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user?.id) return

    let actif = true

    const initialiser = async () => {
      setChargement(true)
      setErreur('')

      const { data, error } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('user_id', session.user.id)
        .single()

      if (!actif) return

      if (error || !data) {
        setErreur('Profil utilisateur introuvable.')
        setProfil(null)
        setChargement(false)
        return
      }

      setProfil(data as Profil)
      setPage(
        data.role === 'entree'
          ? 'ajouter'
          : data.role === 'sortie'
            ? 'sortie'
            : 'dashboard'
            )
      
            await chargerDonnees()
            if (actif) setChargement(false)
          }
      
          void initialiser().catch(e => {
            if (actif) { setErreur(String(e)); setChargement(false) }
          })
      
          return () => { actif = false }
        }, [session?.user?.id])
      
        const chargerDonnees = async () => {
          const stock = await supabase
            .from('hayons')
            .select('reference, serie, statut')
            .order('serie')
      
          if (stock.error) {
            setErreur(stock.error.message)
          } else {
            setHayons((stock.data ?? []) as Hayon[])
            setErreur('')
          }
      
          const historique = await supabase
            .from('mouvements')
            .select(
              'id, reference, serie, type, numero_facture, created_at'
            )
            .order('created_at', { ascending: false })
            .limit(100)
      
          if (historique.error) {
            console.error('Historique :', historique.error.message)
          } else {
            setMouvements(historique.data ?? [])
          }
        }
      
        const connexion = async () => {
          if (operation) return
          setOperation(true)
          setErreur('')
          try {
            const { error } = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password
            })
            if (error) setErreur(error.message)
          } catch (e) {
            setErreur('Connexion impossible : ' + String(e))
          } finally {
            setOperation(false)
          }
        }
      
        const modifierMotDePasse = async () => {
          if (nouveauMotDePasse.length < 12) {
            alert('Le mot de passe doit contenir au moins 12 caractères.')
            return
          }
        
          if (!window.confirm(
            `Modifier le mot de passe de ${utilisateurMotDePasse} ?`
          )) return
        
          setOperation(true)
        
          try {
            const { data, error } = await supabase.functions.invoke(
              'admin-reset-password',
              {
                body: {
                  email: utilisateurMotDePasse,
                  password: nouveauMotDePasse,
                },
              }
            )
        
            if (error) throw error
            if (!data?.success) {
              throw new Error('Modification non confirmée')
            }
        
            setNouveauMotDePasse('')
            alert('Mot de passe modifié avec succès.')
          } catch (e: any) {
            alert('Erreur : ' + (e?.message || String(e)))
          } finally {
            setOperation(false)
          }
          }
          
          const deconnexion = async () => {
            const { error } = await supabase.auth.signOut()
          if (error) setErreur(error.message)
        }
      
        const executerMouvement = async (
          type: 'Entrée' | 'Sortie',
          numero: string,
          ref: string,
          facture: string
        ) => {
          if (operation) return
      
          const num = numero.trim()
          const modele = ref.trim().toUpperCase()
          const facturePropre = facture.trim()
      
          if (!/^[0-9]{8}$/.test(num)) {
            alert('Le numéro de série doit contenir 8 chiffres.')
            return
          }
      
          if (type === 'Entrée' && !modele) {
            alert('La référence du hayon est obligatoire.')
            return
          }
      
          if (type === 'Sortie' && !facturePropre && profil?.role !== 'admin') {
            alert('Le numéro de facture est obligatoire.')
            return
          }
      
          setOperation(true)
      
          try {
            const { error } = await supabase.rpc('mouvement', {
              p_type: type,
              p_serie: num,
              p_reference: modele || null,
              p_numero_facture: type === 'Sortie' ? facturePropre : null
            })
            if (error) {
              alert(
                'Erreur Supabase : ' +
                JSON.stringify({
                  message: error.message,
                  details: error.details,
                  hint: error.hint,
                  code: error.code
                }, null, 2)
              )
              throw error
            }
            setSerie('')
            setReference('')
            if (type === 'Entrée') setNumeroFacture('')
            await chargerDonnees()
            alert(type === 'Entrée' ? 'Entrée enregistrée avec succès.' : 'Sortie enregistrée avec succès.')
      
          } catch (e) {
            console.error('Erreur complète :', e)
            console.log('TYPE ERREUR :', typeof e)
            console.log('MESSAGE :', (e as any)?.message)
            console.log('DETAILS :', (e as any)?.details)
            console.log('CODE :', (e as any)?.code)
alert(
  'Erreur inattendue : ' +
  (e instanceof Error
    ? e.message
    : JSON.stringify(e, null, 2))
)
          } finally {
            setOperation(false)
          }
        }
      
        const changerPage = (nouvellePage: string) => {
          setCameraOuverte(false)
          setPage(nouvellePage)
        }
      
        const receptionScan = (numero: string) => {
          setSerie(numero)
          const existant = hayons.find(h => h.serie === numero)
          if (existant) setReference(existant.reference)
          setCameraOuverte(false)
        }
      
        const exporterCSV = () => {
          const lignes = [
            ['Référence', 'Numéro de série', 'Statut'],
            ...hayons.map(h => [h.reference, h.serie, h.statut])
          ]
      
          const contenu = lignes
            .map(ligne =>
              ligne.map(v =>
                '"' + String(v).replace(/"/g, '""') + '"'
              ).join(';')
            )
            .join('\r\n')
      
          const blob = new Blob(['\uFEFF' + contenu], {
            type: 'text/csv;charset=utf-8'
          })
      
          const url = URL.createObjectURL(blob)
          const lien = document.createElement('a')
          lien.href = url
          lien.download = 'stock-dhollandia-maroc.csv'
          lien.click()
          URL.revokeObjectURL(url)
        }
      
        const estAdmin = profil?.role === 'admin'
        const peutEntrer = estAdmin || profil?.role === 'entree'
        const peutSortir = estAdmin || profil?.role === 'sortie'
      
        const enStock = hayons.filter(
          h => h.statut === 'En stock'
        ).length
      
        const sortis = hayons.filter(
          h => h.statut === 'Sorti'
        ).length
      
        const references = new Set(
          hayons.map(h => h.reference)
        ).size
      
        const resultats = hayons.filter(h =>
          h.reference.toLowerCase().includes(
            recherche.toLowerCase()
          ) || h.serie.includes(recherche)
        )
      
        if (!session) {
          return (
            <div className="application">
              <main className="contenu">
                <section className="panneau formulaire">
                  <h1>DHOLLANDIA MAROC</h1>
                  <h2>Connexion à la gestion de stock</h2>
      
                  <label>Adresse e-mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Adresse e-mail"
                  />
      
                  <label>Mot de passe</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Mot de passe"
                    onKeyDown={e => {
                      if (e.key === 'Enter') connexion()
                    }}
                  />
      
                  {erreur && <p style={{ color: 'red' }}>{erreur}</p>}

<button
  className="bouton-principal"
  onClick={connexion}
  disabled={operation}
>
  Se connecter
</button>
</section>
</main>
</div>
)
}

if (chargement) {
return <p>Chargement de DHOLLANDIA MAROC...</p>
}

if (!profil) {
return (
<div>
<p>{erreur || 'Accès non autorisé.'}</p>
<button onClick={deconnexion}>Déconnexion</button>
</div>
)
}

return (
<div className="application">
<aside className="sidebar">
<div className="logo">
<h2>DHOLLANDIA</h2>
<span>MAROC</span>
</div>

<nav>
<button
className={page === 'dashboard' ? 'actif' : ''}
onClick={() => changerPage('dashboard')}
>
Tableau de bord
</button>

<button
className={page === 'stock' ? 'actif' : ''}
onClick={() => changerPage('stock')}
>
Stock des hayons
</button>

{peutEntrer && (

<button
className={page === 'ajouter' ? 'actif' : ''}
onClick={() => changerPage('ajouter')}
>
Entrée de stock
</button>
)}

{peutSortir && (
<button
className={page === 'sortie' ? 'actif' : ''}
onClick={() => changerPage('sortie')}
>
Sortie de stock
</button>
)}

{estAdmin && (
<button
className={page === 'historique' ? 'actif' : ''}
onClick={() => changerPage('historique')}
>
Historique
</button>
)}

<button onClick={deconnexion}>
Déconnexion
</button>
</nav>

<div className="sidebar-bas">
DHOLLANDIA MAROC
<small>Gestion des hayons</small>
</div>
</aside>

<main className="contenu">
<header className="entete">
<div>
<h1>
{page === 'dashboard' && 'Tableau de bord'}
{page === 'stock' && 'Stock des hayons'}
{page === 'ajouter' && 'Entrée de stock'}
{page === 'sortie' && 'Sortie de stock'}
{page === 'historique' && 'Historique'}
</h1>
<p>DHOLLANDIA MAROC · Gestion de stock</p>
</div>


<span className="profil">
            {profil.full_name} · {profil.role}
          </span>
        </header>

        {erreur && (
          <p style={{ color: 'red' }}>
            Erreur Supabase : {erreur}
          </p>
        )}

        {page === 'dashboard' && (
          <>
            <div className="statistiques">
              <div className="carte">
                <span>Hayons en stock</span>
                <strong>{enStock}</strong>
                <small>Disponibles</small>
              </div>

              <div className="carte">
                <span>Références</span>
                <strong>{references}</strong>
                <small>Modèles enregistrés</small>
              </div>

              <div className="carte">
                <span>Hayons sortis</span>
                <strong>{sortis}</strong>
                <small>Hors stock</small>
              </div>

<div className="carte">
  <span>Total enregistré</span>
  <strong>{hayons.length}</strong>
  <small>Numéros de série</small>
</div>
</div>

<section className="panneau">
<h2>Stock par référence</h2>

<div className="tableau">
  <table>
    <thead>
      <tr>
        <th>Référence</th>
        <th>Quantité en stock</th>
      </tr>
    </thead>
    <tbody>
      {[...new Set(
        hayons.map(h => h.reference)
      )].map(ref => (
        <tr key={ref}>
          <td><strong>{ref}</strong></td>
          <td>
            {hayons.filter(h =>
              h.reference === ref &&
              h.statut === 'En stock'
            ).length}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
</section>
</>
)}

{page === 'stock' && (
<section className="panneau">
<div className="panneau-entete">
<h2>Inventaire des hayons</h2>
<button
  className="bouton-principal"
  onClick={exporterCSV}
  >
    Exporter CSV
  </button>
              </div>
  
              <input
                className="recherche"
                placeholder="Rechercher référence ou série..."
                value={recherche}
                onChange={e => setRecherche(e.target.value)}
              />
  
              <div className="tableau">
                <table>
                  <thead>
                    <tr>
                      <th>Référence</th>
                      <th>Numéro de série</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
  
                  <tbody>
                    {resultats.map(h => (
                      <tr key={h.serie}>
                        <td><strong>{h.reference}</strong></td>
                        <td>{h.serie}</td>
                        <td>
                          <span className={
                            h.statut === 'En stock'
                              ? 'statut-vert'
                              : 'statut-rouge'
                          }>
                            {h.statut}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>


                {resultats.length === 0 && (
                <p>Aucun hayon trouvé.</p>
              )}
            </div>
          </section>
        )}

        {page === 'ajouter' && peutEntrer && (
          <section className="panneau formulaire">
            <h2>Enregistrer une entrée</h2>
            <p>
              Scanne le code-barres ou saisis le numéro
              de série du hayon.
            </p>

            <label>Référence du hayon</label>
            <input
              placeholder="Exemple : DHLM.15"
              value={reference}
              onChange={e => setReference(e.target.value)}
            />

            <button type="button" className="bouton-principal"
              onClick={() => setCameraOuverte(v => !v)}>
              {cameraOuverte ? 'Fermer le scanner' : '📷 Scanner avec le téléphone'}
            </button>
            {cameraOuverte && (
              <ScannerCamera onScan={receptionScan} onFermer={() => setCameraOuverte(false)} />
            )}

            <label>Numéro de série / Code-barres</label>
            <input
              placeholder="Scanner ici"
              value={serie}
              onChange={e => setSerie(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  executerMouvement(
                    'Entrée', serie, reference, ''
                  )
                }
              }}
            />

            <button
              className="bouton-principal"
              disabled={operation}
              onClick={() =>
                executerMouvement(
                  'Entrée', serie, reference, ''
                )
              }
            >
              {operation
                ? 'Enregistrement...'
                : "Enregistrer l'entrée"}
            </button>
          </section>
        )}

        {page === 'sortie' && peutSortir && (
          <section className="panneau formulaire">
          <h2>Enregistrer une sortie</h2>
          <p>
          {profil?.role === 'admin'
  ? 'Numéro de facture facultatif pour les administrateurs.'
  : 'Chaque sortie nécessite un numéro de facture.'}
          </p>

          <label>
  Numéro de facture {profil?.role === 'admin' ? '(facultatif)' : '(obligatoire)'}
</label>
          <input
            placeholder="Exemple : FA2611-0001"
            value={numeroFacture}
            onChange={e =>

              setNumeroFacture(e.target.value)
            }
          />

          <button type="button" className="bouton-principal"
            onClick={() => setCameraOuverte(v => !v)}>
            {cameraOuverte ? 'Fermer le scanner' : '📷 Scanner avec le téléphone'}
          </button>
          {cameraOuverte && (
            <ScannerCamera onScan={receptionScan} onFermer={() => setCameraOuverte(false)} />
          )}

          <label>Numéro de série / Code-barres</label>
          <input
            placeholder="Scanner ici"
            value={serie}
            onChange={e => setSerie(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                executerMouvement(
                  'Sortie', serie, '', numeroFacture
                )
              }
            }}
          />

{seriesSupplementaires.map((numero, index) => (
  <div key={index} style={{ marginTop: 12 }}>
    <label>Numéro de série supplémentaire {index + 2}</label>
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        placeholder="Scanner ou saisir le numéro"
        value={numero}
        onChange={e => {
          setSeriesSupplementaires(anciens =>
            anciens.map((valeur, i) =>
              i === index ? e.target.value : valeur
            )
          )
        }}
      />
      <button
        type="button"
        onClick={() =>
          setSeriesSupplementaires(anciens =>
            anciens.filter((_, i) => i !== index)
          )
        }
      >
        Supprimer
      </button>
    </div>
  </div>
))}

<button
  type="button"
  className="bouton-principal"
  style={{ marginTop: 12, marginBottom: 12 }}
  onClick={() =>
    setSeriesSupplementaires(anciens => [...anciens, ''])
  }
>
  + Ajouter un numéro de série
</button>

          <button
            className="bouton-principal"
            disabled={operation}
            onClick={async () => {
              const numeros = [serie, ...seriesSupplementaires]
                .map(numero => numero.trim())
                .filter(Boolean)
            
              if (numeros.length === 0) {
                alert('Ajoute au moins un numéro de série.')
                return
              }
            
              if (numeros.some(numero => !/^[0-9]{8}$/.test(numero))) {
                alert('Chaque numéro de série doit contenir 8 chiffres.')
                return
              }
            
              if (new Set(numeros).size !== numeros.length) {
                alert('Un numéro de série est présent plusieurs fois.')
                return
              }
            
              try {
                setOperation(true)
              
                const facture = numeroFacture.trim()
              
                // Enregistrer chaque hayon dans Supabase
                for (const num of numeros) {
                  const { error } = await supabase.rpc('mouvement', {
                    p_type: 'Sortie',
                    p_serie: num,
                    p_reference: null,
                    p_numero_facture: facture || null,
                  })
              
                  if (error) {
                    throw new Error(
                      `Erreur pour le hayon ${num} : ${error.message}`
                    )
                  }
                }
              
                await chargerDonnees()
              
                setSerie('')
                setSeriesSupplementaires([])
                setNumeroFacture('')
              
                alert(`${numeros.length} hayon(s) sorti(s) avec succès.`)
              } catch (error: any) {
                alert(error?.message || 'Erreur lors de la sortie.')
              } finally {
                setOperation(false)
              }
            }}
          >
            {operation
              ? 'Enregistrement...'
              : 'Valider la sortie'}
          </button>
        </section>

)}

{page === 'historique' && estAdmin && (
  <section className="panneau">
    <h2>Historique des mouvements</h2>

    <div className="tableau">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Référence</th>
            <th>Numéro de série</th>
            <th>Facture</th>
          </tr>
        </thead>

        <tbody>
          {mouvements.map(m => (
            <tr key={m.id}>
              <td>

              {new Date(
                  m.created_at
                ).toLocaleString('fr-FR')}
              </td>
              <td>{m.type}</td>
              <td>{m.reference}</td>
              <td>{m.serie}</td>
              <td>{m.numero_facture || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>


      {mouvements.length === 0 && (
  <p>Aucun mouvement enregistré.</p>
)}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App


  
      