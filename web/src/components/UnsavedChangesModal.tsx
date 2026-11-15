import { Button, Group, Modal, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/** SPEC 3.5: leaving with unsaved changes offers Save, Discard and Keep editing. */
export function UnsavedChangesModal({
  opened,
  onSave,
  onDiscard,
  onKeepEditing,
}: {
  opened: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onKeepEditing} title={t('unsaved.title')} size="sm">
      <Text size="sm">{t('unsaved.body')}</Text>
      <Group justify="flex-end" mt="lg" gap="xs">
        <Button variant="subtle" color="neutral" onClick={onKeepEditing}>
          {t('common.keepEditing')}
        </Button>
        <Button variant="light" color="red" onClick={onDiscard}>
          {t('common.discard')}
        </Button>
        <Button onClick={onSave} data-autofocus>
          {t('common.save')}
        </Button>
      </Group>
    </Modal>
  );
}
