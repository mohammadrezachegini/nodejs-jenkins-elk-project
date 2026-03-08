/**
 * Jenkinsfile — Declarative CI/CD Pipeline
 *
 * agent any — runs on Jenkins host (Ubuntu)
 * npm stages run inside Docker containers via docker run
 * docker build/push run directly on host
 * Stage 8 triggers ArgoCD sync and waits for deployment to complete
 *
 * Required Jenkins Credentials:
 *   Secret text  — DOCKERHUB_REPO     e.g. youruser/nodejs-product-catalog
 *   Secret text  — GIT_REPO_URL       e.g. https://github.com/youruser/repo.git
 *   Secret text  — ARGOCD_TOKEN       ArgoCD admin token
 *   Secret text  — ARGOCD_SERVER      e.g. localhost:8090
 *   User/pass    — dockerhub-creds    Docker Hub username + access token
 *   User/pass    — github-token       GitHub username + PAT
 */

pipeline {
    agent any

    environment {
        DOCKERHUB_REPO = credentials('DOCKERHUB_REPO')
        GIT_REPO_URL   = credentials('GIT_REPO_URL')
        ARGOCD_TOKEN   = credentials('ARGOCD_TOKEN')
        ARGOCD_SERVER  = credentials('ARGOCD_SERVER')
        IMAGE_TAG      = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
        timestamps()
    }

    stages {

        // ── Stage 1: Checkout ───────────────────────────────────────────────
        stage('Checkout') {
            steps {
                echo "==> Commit: ${env.IMAGE_TAG}"
                sh 'git log --oneline -5'
            }
        }

        // ── Stage 2: Install ────────────────────────────────────────────────
        // node:20-alpine — lightweight, only needs npm ci (no mongo needed)
        stage('Install') {
            steps {
                echo '==> Installing npm dependencies'
                sh """
                    docker run --rm \
                        -v ${WORKSPACE}/app:/app \
                        -w /app \
                        node:20-alpine \
                        npm ci --frozen-lockfile
                """
            }
        }

        // ── Stage 3: Test ───────────────────────────────────────────────────
        // node:20 (Debian) — mongodb-memory-server does not support Alpine
        // MONGOMS_VERSION=7.0.14 — Debian 12 requires MongoDB 7.0.3+
        stage('Test') {
            steps {
                echo '==> Running Jest tests'
                sh """
                    docker run --rm \
                        -v ${WORKSPACE}/app:/app \
                        -w /app \
                        -e MONGOMS_VERSION=7.0.14 \
                        node:20 \
                        npm test
                """
            }
            post {
                always {
                    junit allowEmptyResults: true,
                          testResults: 'app/junit.xml'
                }
            }
        }

        // ── Stage 4: Docker Build ───────────────────────────────────────────
        stage('Docker Build') {
            steps {
                echo "==> Building image: ${DOCKERHUB_REPO}:${IMAGE_TAG}"
                sh """
                    docker build \
                        --tag ${DOCKERHUB_REPO}:${IMAGE_TAG} \
                        --tag ${DOCKERHUB_REPO}:latest \
                        app/
                """
            }
        }

        // ── Stage 5: Push to Docker Hub ─────────────────────────────────────
        stage('Push to Docker Hub') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub-creds',
                        usernameVariable: 'DH_USER',
                        passwordVariable: 'DH_TOKEN'
                    )
                ]) {
                    sh """
                        echo "${DH_TOKEN}" | docker login \
                            --username ${DH_USER} \
                            --password-stdin

                        docker push ${DOCKERHUB_REPO}:${IMAGE_TAG}
                        docker push ${DOCKERHUB_REPO}:latest

                        docker logout
                    """
                }
            }
        }

        // ── Stage 6: Update Helm values.yaml ────────────────────────────────
        // Updates image tag in values.yaml — ArgoCD detects this change
        // and automatically deploys the new image to K8s
        stage('Update Helm Chart') {
            steps {
                sh """
                    sed -i 's|tag: .*|tag: "${IMAGE_TAG}"|' helm/nodejs-app/values.yaml
                    sed -i 's|tag: .*|tag: "${IMAGE_TAG}"|' helm/nodejs-app/values-prod.yaml
                    echo '==> Updated image tag to: ${IMAGE_TAG}'
                    grep 'tag:' helm/nodejs-app/values.yaml
                """
            }
        }

        // ── Stage 7: Push updated values.yaml to Git ────────────────────────
        // ArgoCD watches this file — when tag changes, ArgoCD syncs the cluster
        // [skip ci] prevents Jenkins from re-triggering on this commit
        stage('Push to Git') {
            when {
                branch 'master'
            }
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'github-token',
                        usernameVariable: 'GIT_USER',
                        passwordVariable: 'GIT_TOKEN'
                    )
                ]) {
                    sh """
                        git config user.email "jenkins@ci.local"
                        git config user.name "Jenkins CI"

                        git add helm/nodejs-app/values.yaml
                        git add helm/nodejs-app/values-prod.yaml

                        git diff --staged --quiet || git commit -m "ci: update image tag to ${IMAGE_TAG} [skip ci]"

                        REPO_URL_NO_SCHEME=\$(echo "${GIT_REPO_URL}" | sed 's|https://||')
                        git push https://${GIT_USER}:${GIT_TOKEN}@\${REPO_URL_NO_SCHEME} HEAD:master
                    """
                }
                echo '==> Git updated — triggering ArgoCD sync now'
            }
        }

        // ── Stage 8: Trigger ArgoCD Sync ────────────────────────────────────
        // Triggers immediate ArgoCD sync instead of waiting for 3min poll
        // Then polls ArgoCD every 5 seconds until deployment succeeds or fails
        // Jenkins build only turns green when the pod is actually Running in K8s
        stage('Deploy via ArgoCD') {
            when {
                branch 'master'
            }
            steps {
                sh """
                    echo "==> Triggering ArgoCD sync"

                    # Trigger sync via ArgoCD API
                    curl -s -k -X POST \
                        -H "Authorization: Bearer ${ARGOCD_TOKEN}" \
                        -H "Content-Type: application/json" \
                        https://${ARGOCD_SERVER}/api/v1/applications/nodejs-product-catalog/sync \
                        -d '{"prune": true}'

                    echo ""
                    echo "==> Waiting for deployment to complete..."

                    # Poll every 5 seconds for up to 2 minutes (24 attempts)
                    for i in \$(seq 1 24); do
                        STATUS=\$(curl -s -k \
                            -H "Authorization: Bearer ${ARGOCD_TOKEN}" \
                            https://${ARGOCD_SERVER}/api/v1/applications/nodejs-product-catalog \
                            | grep -o '"phase":"[^"]*"' | head -1 | cut -d'"' -f4)

                        HEALTH=\$(curl -s -k \
                            -H "Authorization: Bearer ${ARGOCD_TOKEN}" \
                            https://${ARGOCD_SERVER}/api/v1/applications/nodejs-product-catalog \
                            | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

                        echo "==> Attempt \$i/24 — Sync: \$STATUS | Health: \$HEALTH"

                        if [ "\$STATUS" = "Succeeded" ] && [ "\$HEALTH" = "Healthy" ]; then
                            echo "✅ Deployment complete — app is healthy"
                            exit 0
                        fi

                        if [ "\$STATUS" = "Failed" ] || [ "\$STATUS" = "Error" ]; then
                            echo "❌ Deployment failed — check ArgoCD UI"
                            exit 1
                        fi

                        sleep 5
                    done

                    echo "⚠️ Sync timed out after 120s — check ArgoCD UI"
                    exit 1
                """
            }
        }

    } // end stages

    post {
        success {
            echo "✅ Pipeline SUCCESS — ${DOCKERHUB_REPO}:${IMAGE_TAG} is live in K8s"
        }
        failure {
            echo '❌ Pipeline FAILED — check the logs above'
        }
        always {
            sh """
                docker rmi ${DOCKERHUB_REPO}:${IMAGE_TAG} || true
                docker rmi ${DOCKERHUB_REPO}:latest || true
            """
        }
    }

} // end pipeline