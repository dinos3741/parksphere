import React, { useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback, TextInput, Image, Alert, Keyboard } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '../context/AuthContext';

const SpotDetailsModal = ({ visible, spot, onClose, onRequestSpot, onDeleteSpot, onUpdateSpot, userLocation, acceptedSpot, arrivalConfirmed, onOpenChat, onConfirmArrival }) => {
  const { userId } = useAuth();
  // Which field (if any) is currently showing an inline edit TextInput instead of its plain value.
  const [editingField, setEditingField] = useState(null); // null | 'timeToLeave' | 'price'
  const [editValue, setEditValue] = useState('');

  if (!spot) return null;

  const isOwner = String(userId) === String(spot.user_id); // Use userId from context
  const isAccepted = acceptedSpot && spot.id === acceptedSpot.id;

  const handleUsernameClick = () => {
    onClose();
    onOpenChat({ id: spot.user_id, username: spot.username });
  };

  // userLocation can genuinely be null now (permission denied, or not acquired yet) — previously it
  // was always a real or hardcoded-fallback object, so this call site never needed to check.
  const handleRequestSpot = () => {
    if (!userLocation) {
      Alert.alert('Error', 'Could not determine your location. Please check your location settings.');
      return;
    }
    onRequestSpot(spot.id, userLocation.latitude, userLocation.longitude);
  };

  const handleDeletePress = () => {
    Alert.alert(
      'Delete this spot?',
      'This removes it from the map for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { onDeleteSpot(spot.id); onClose(); } },
      ]
    );
  };

  const startEdit = (field, currentValue) => {
    if (!isOwner) return;
    setEditingField(field);
    setEditValue(String(currentValue));
  };

  // Fires from both onSubmitEditing (return key) and onBlur (tapping elsewhere) — harmless if both
  // land for the same edit, since the second call finds editingField already cleared and no-ops.
  const commitEdit = () => {
    if (editingField === 'timeToLeave') {
      const parsed = parseInt(editValue, 10);
      if (isNaN(parsed) || parsed < 1) {
        Alert.alert('Invalid duration', 'Enter a whole number of minutes (at least 1).');
      } else {
        onUpdateSpot(spot.id, { timeToLeave: parsed });
      }
    } else if (editingField === 'price') {
      const parsed = parseInt(editValue, 10);
      if (isNaN(parsed) || parsed < 0) {
        Alert.alert('Invalid price', 'Enter a whole number of credits (0 or more).');
      } else {
        onUpdateSpot(spot.id, { price: parsed });
      }
    }
    setEditingField(null);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={styles.card}>
              <View style={styles.header}>
                <Text style={styles.title}>Spot Details</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={20} color="#888" />
                </TouchableOpacity>
              </View>

              <View style={styles.detailsSection}>
                <View style={styles.detailRow}>
                  <View style={styles.detailLabelGroup}>
                    <Ionicons name="time-outline" size={17} color="#512da8" style={styles.detailIcon} />
                    <Text style={styles.detailLabel}>Time to leave</Text>
                  </View>
                  {editingField === 'timeToLeave' ? (
                    <View style={styles.editingGroup}>
                      <TextInput
                        style={styles.detailInput}
                        value={editValue}
                        onChangeText={setEditValue}
                        keyboardType="numeric"
                        autoFocus
                        selectTextOnFocus
                        returnKeyType="done"
                        onSubmitEditing={commitEdit}
                        onBlur={commitEdit}
                      />
                      <TouchableOpacity onPress={() => { commitEdit(); Keyboard.dismiss(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="checkmark-circle" size={22} color="#512da8" style={styles.confirmEditIcon} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity disabled={!isOwner} onPress={() => startEdit('timeToLeave', spot.time_to_leave)}>
                      <Text style={[styles.detailValue, isOwner && styles.editableValue]}>{spot.time_to_leave} min</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.rowDivider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailLabelGroup}>
                    <Ionicons name="pricetag-outline" size={17} color="#512da8" style={styles.detailIcon} />
                    <Text style={styles.detailLabel}>Price</Text>
                  </View>
                  {editingField === 'price' ? (
                    <View style={styles.editingGroup}>
                      <TextInput
                        style={styles.detailInput}
                        value={editValue}
                        onChangeText={setEditValue}
                        keyboardType="numeric"
                        autoFocus
                        selectTextOnFocus
                        returnKeyType="done"
                        onSubmitEditing={commitEdit}
                        onBlur={commitEdit}
                      />
                      <TouchableOpacity onPress={() => { commitEdit(); Keyboard.dismiss(); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="checkmark-circle" size={22} color="#512da8" style={styles.confirmEditIcon} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity disabled={!isOwner} onPress={() => startEdit('price', spot.price)}>
                      <Text style={[styles.detailValue, isOwner && styles.editableValue]}>{spot.price} credits</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {!!spot.comments && (
                  <>
                    <View style={styles.rowDivider} />
                    <View style={styles.detailRow}>
                      <View style={styles.detailLabelGroup}>
                        <Ionicons name="chatbubble-ellipses-outline" size={17} color="#512da8" style={styles.detailIcon} />
                        <Text style={styles.detailLabel}>Comments</Text>
                      </View>
                      <Text style={styles.detailValueWrap} numberOfLines={2}>{spot.comments}</Text>
                    </View>
                  </>
                )}
              </View>

              {!isOwner && (
                <View style={styles.detailsSection}>
                  <Text style={styles.sectionLabel}>OWNER DETAILS</Text>
                  {/* 2026-08-07: used to be bundled with car color/plate below, all gated behind
                      isAccepted — but messaging the owner shouldn't require an accepted request
                      first (e.g. asking "are you really leaving?" before you've even requested the
                      spot). Car color/plate stay accepted-only: the server already nulls those two
                      out for a non-accepted viewer (GET /api/parkingspots' privacy logic), so
                      showing their rows here would just render blank values. */}
                  <TouchableOpacity style={styles.detailRow} onPress={handleUsernameClick}>
                    <View style={styles.detailLabelGroup}>
                      <Ionicons name="person-outline" size={17} color="#512da8" style={styles.detailIcon} />
                      <Text style={styles.detailLabel}>Username</Text>
                    </View>
                    <Text style={[styles.detailValue, styles.linkValue]}>{spot.username}</Text>
                  </TouchableOpacity>
                  {isAccepted && (
                    <>
                      <View style={styles.rowDivider} />
                      <View style={styles.detailRow}>
                        <View style={styles.detailLabelGroup}>
                          <Ionicons name="color-palette-outline" size={17} color="#512da8" style={styles.detailIcon} />
                          <Text style={styles.detailLabel}>Car color</Text>
                        </View>
                        <Text style={styles.detailValue}>{spot.car_color}</Text>
                      </View>
                      <View style={styles.rowDivider} />
                      <View style={styles.detailRow}>
                        <View style={styles.detailLabelGroup}>
                          <Ionicons name="card-outline" size={17} color="#512da8" style={styles.detailIcon} />
                          <Text style={styles.detailLabel}>Plate</Text>
                        </View>
                        <Text style={styles.detailValue}>{spot.plate_number}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}

              {!isOwner && !isAccepted && ( // Only show Request Spot button if not the owner and not accepted
                <TouchableOpacity style={styles.primaryButton} onPress={handleRequestSpot}>
                  <Text style={styles.primaryButtonText}>Request Spot</Text>
                </TouchableOpacity>
              )}

              {isOwner && (
                <TouchableOpacity style={styles.deleteLink} onPress={handleDeletePress}>
                  <Text style={styles.deleteLinkText}>Delete Spot</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableWithoutFeedback>

          {isAccepted && !arrivalConfirmed && (
            <TouchableOpacity
              style={styles.fab}
              onPress={onConfirmArrival}
            >
              <Image source={require('../assets/images/arrived.png')} style={styles.fabIcon} />
            </TouchableOpacity>
          )}
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#222',
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f0f0f4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsSection: {
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  // Icon + label kept together as one group on the left, so `space-between` on detailRow only
  // pushes the value to the right — a plain flex:1 on the label alone squeezed the value's actual
  // available width down to near-nothing regardless of its own maxWidth, wrapping short values like
  // "2 min" character-by-character.
  detailLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailIcon: {
    marginRight: 10,
  },
  detailLabel: {
    fontSize: 15,
    color: '#666',
  },
  // No width cap — sized to its own short content (values here are always brief, e.g. "2 min"),
  // so it never wraps. detailValueWrap (below) is the deliberately-capped variant, used only for
  // comments, which can genuinely be long.
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    textAlign: 'right',
  },
  detailValueWrap: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    maxWidth: '55%',
    textAlign: 'right',
  },
  // Owner-only affordance, tappable rows only — a dotted underline hints they're editable without
  // needing a separate Edit Spot button/screen.
  editableValue: {
    color: '#512da8',
    borderBottomWidth: 1,
    borderBottomColor: '#d8cdf0',
    borderStyle: 'dashed',
  },
  // TextInput + a checkmark to confirm — the iOS numeric keypad has no Return key, and
  // InputAccessoryView (the usual fix for that) doesn't reliably dock when the focused input is
  // inside a <Modal>, so a plain in-row confirm button is the reliable option here instead.
  editingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailInput: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222',
    minWidth: 50,
    textAlign: 'right',
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#512da8',
  },
  confirmEditIcon: {
    marginLeft: 8,
  },
  linkValue: {
    color: '#512da8',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e2e6',
  },
  // Pill-shaped, matches UserDetails.js's vehicle-edit modal button.
  primaryButton: {
    backgroundColor: '#512da8',
    height: 49,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 24.5,
    marginTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteLink: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  deleteLinkText: {
    color: '#c62828',
    fontSize: 15,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    width: 91,
    height: 91,
    borderRadius: 46,
    backgroundColor: '#9b59b6',
    justifyContent: 'center',
    alignItems: 'center',
    bottom: 170,
    alignSelf: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabIcon: {
    width: 55,
    height: 55,
    resizeMode: 'contain',
  },
});

export default SpotDetailsModal;
