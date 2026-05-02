<script setup lang="ts">
import { useBridge, useSyncTaskStore } from '@tg-search/client'
import { CoreEventType } from '@tg-search/core'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Button } from './ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog'

const { t } = useI18n()
const bridge = useBridge()
const { takeoutConfirmNeeded } = storeToRefs(useSyncTaskStore())

const isOpen = computed({
  get: () => takeoutConfirmNeeded.value,
  set: (value) => {
    if (value) {
      takeoutConfirmNeeded.value = true
    }
  },
})

function handleTakeoutConfirm(useTakeout: boolean) {
  takeoutConfirmNeeded.value = false
  bridge.sendEvent(CoreEventType.TakeoutConfirmResponse, { useTakeout })
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-[560px]" :show-close-button="false">
      <DialogHeader>
        <div class="flex items-start gap-4 text-left">
          <div class="h-12 w-12 flex shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
            <span class="i-lucide-shield-check h-6 w-6 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <DialogTitle>{{ t('sync.takeoutConfirmTitle') }}</DialogTitle>
            <DialogDescription class="mt-2 text-sm leading-relaxed">
              {{ t('sync.takeoutConfirmDescription') }}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <div class="flex items-start gap-3 border border-destructive/30 rounded-lg bg-destructive/5 p-3">
        <span class="i-lucide-alert-triangle mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p class="text-sm text-destructive leading-relaxed">
          {{ t('sync.takeoutConfirmRisk') }}
        </p>
      </div>

      <DialogFooter class="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          icon="i-lucide-shield-off"
          variant="outline"
          class="w-full border-destructive/40 text-destructive sm:w-auto hover:bg-destructive/10"
          @click="handleTakeoutConfirm(false)"
        >
          {{ t('sync.takeoutConfirmUseGetHistory') }}
        </Button>
        <Button
          icon="i-lucide-shield-check"
          class="w-full sm:w-auto"
          @click="handleTakeoutConfirm(true)"
        >
          {{ t('sync.takeoutConfirmAuthorize') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
